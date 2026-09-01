import { NotFoundError } from '../errors/mod.js';
import HyperviewPage from './hyperview-page.js';
import { compileHyperviewTemplate } from './template-compiler.js';
import deepMerge from '../utils/deep-merge.js';
import {
    assert,
    assertArray,
    assertFunction,
    assertNonEmptyString,
    isFunction,
    isPlainObject,
    isUndefined,
    isNonEmptyString,
} from '../assertions/mod.js';


// Versioned bundles only coexist while requests finish across a publication, so
// a handful of generations is enough to cover the overlap.
const MAX_VERSIONED_TEMPLATE_CACHE_ENTRIES = 4;

// Page-specific content can vary across many routes, so it needs a larger bound.
const MAX_PAGE_PARTIAL_CACHE_ENTRIES = 1000;
const MAX_PAGE_TEMPLATE_CACHE_ENTRIES = 1000;


// The get/read portion of an LRU cache on a Map.
function getCachedEntry(cache, key) {
    const entry = cache.get(key);

    // Map iteration follows insertion order. Reinsert a cache hit so it becomes
    // the most recently used entry at the end of that order.
    cache.delete(key);
    cache.set(key, entry);
    return entry;
}

// The set/write portion of an LRU cache on a Map.
function setCachedEntry(cache, key, entry, maxEntries) {
    cache.set(key, entry);

    // Cache hits are moved to the end, leaving the least recently used key at
    // the front for eviction whenever the cache exceeds its size limit.
    while (cache.size > maxEntries) {
        cache.delete(cache.keys().next().value);
    }
    return entry;
}

function layerPartials(primary, secondary) {
    // Page partials take precedence over global partials for this render only.
    return new Map([ ...secondary, ...primary ]);
}

// Compiles template source with built-in and caller-provided helpers.
function compileTemplate(templateId, source) {
    return compileHyperviewTemplate(templateId, source).render;
}

/**
 * Renders published site content into Hyperview page results and email bodies.
 *
 * This is the only place the framework turns *content* into *output*. It owns
 * three things and nothing else: choosing what to render, compiling and caching
 * the templates that render it, and caching the rendered result. Where the
 * content comes from belongs to the ContentAddressableStore; what the assembled
 * template context looks like belongs to HyperviewPage.
 *
 * ## One snapshot per render
 * Every render opens exactly one {@link ContentSnapshot} and reads everything
 * through it — page assets, template bundles, and the hashes that become cache
 * keys. A deploy landing mid-request is therefore invisible to a render already
 * in flight: it cannot compose a document from a mix of two publications, and it
 * cannot key a cache entry with hashes that never coexisted.
 *
 * ## The three render modes
 * `renderPage()` serves one page three ways, because a hypermedia
 * application asks for the same page at three granularities:
 *
 * - `options.partial` renders a single named page partial. The browser fetches
 *   these to replace a fragment of the current document in place.
 * - `options.skipBaseRender` renders the page template alone, without the
 *   surrounding document. The browser fetches these for page transitions.
 * - Neither option renders the page template and then wraps it in a base
 *   template, producing the complete document a cold request needs.
 *
 * All three assemble the identical page context; only the outermost template
 * changes. The render mode is part of the page-cache identity, so the three
 * outputs for one URL never collide.
 *
 * ## Two caches, invalidated differently
 * The compiled-template caches (global partials, base templates, page partials,
 * page templates) live in this instance's memory and are keyed by the content
 * hash of the bundle they were compiled from. Because content addresses are
 * immutable, a stale entry is unreachable rather than wrong, and older
 * generations are retained on purpose so a request pinned to an older snapshot
 * can still finish. They are only populated when `useTemplateCache` is on, which
 * is fixed for the lifetime of the service so development can edit templates
 * without a restart.
 *
 * The rendered-page cache lives in the KV store, is shared across instances, and
 * is keyed by a hash covering every content hash the render read plus — by
 * default — the runtime props. That props default is a safety property, not an
 * optimization: without it, a page rendered for one signed-in user would be
 * served to the next.
 *
 * ## Lifecycle
 * Constructed with its policy defaults before the services it reads through
 * exist, so {@link HyperviewService#initialize} supplies those in a second
 * phase. Every render method requires initialize() to have run.
 * @see HyperviewPage in ./hyperview-page.js for how the template context is assembled
 * @see ContentSnapshot in ../content-addressable-store/content-snapshot.js for the content reads
 */
export default class HyperviewService {

    // Helpers available to every template this service compiles, including
    // metadata mini templates. Documented for template authors in
    // src/templates/README.md.
    // Immutable partial maps, indexed by their content bundle etags.
    #globalPartials = new Map();

    // Immutable template maps, indexed by their content bundle etags.
    #baseTemplates = new Map();

    // Immutable compiled page partials, indexed by their content bundle hash.
    #pagePartials = new Map();

    // Immutable compiled page templates, indexed by normalized template filepath.
    #pageTemplates = new Map();

    // Asset maps are immutable for one /assets tree hash, just like compiled
    // template bundles. Keep a few generations so in-flight old snapshots can
    // still render the URL shape matching their own closure.
    #staticAssets = new Map();

    #useTemplateCache;
    #usePageCache;

    #allowJsonResponse;

    #pageCacheReadTtlSeconds;
    #pageCacheExpirationSeconds;

    #logger;
    #contentAddressableStore;
    #kvStore;

    /**
     * @param {Object} options
     * @param {import('../logger/logger.js').default} options.logger - Root logger used to create a HyperviewService child logger
     * @param {boolean} [options.useTemplateCache=false] - Reuse compiled templates until their content hash changes; fixed for the lifetime of the service
     * @param {boolean} [options.usePageCache=false] - Default rendered-page cache policy; overridable per render
     * @param {number} [options.pageCacheReadTtlSeconds=86400] - Default cache TTL for rendered-page reads, in seconds
     * @param {number} [options.pageCacheExpirationSeconds=86400] - Default expiration for rendered-page writes, in seconds
     * @param {boolean} [options.allowJsonResponse=false] - Allow explicit JSON requests to receive assembled page context by default
     */
    constructor(options) {
        const {
            logger,
            useTemplateCache = false,
            usePageCache = false,
            pageCacheReadTtlSeconds = 60 * 60 * 24,
            pageCacheExpirationSeconds = 60 * 60 * 24,
            allowJsonResponse = false,
        } = options ?? {};

        assert(logger, 'HyperviewService requires a logger');

        this.#logger = logger.createChild('HyperviewService');
        this.#useTemplateCache = useTemplateCache;
        this.#usePageCache = usePageCache;
        this.#pageCacheReadTtlSeconds = pageCacheReadTtlSeconds;
        this.#pageCacheExpirationSeconds = pageCacheExpirationSeconds;
        this.#allowJsonResponse = allowJsonResponse;
    }

    /**
     * Connects the content and cache services required by the rendering methods.
     * Call this once after construction and before rendering a page or email.
     * @param {Object} args - Rendering service dependencies
     * @param {import('../key-value-store/key-value-store-interface.js').KeyValueStoreInterface} args.kvStore - Key-value store holding the rendered-page cache
     * @param {import('../content-addressable-store/content-addressable-store.js').default} args.contentAddressableStore - Published content store used to open snapshots, normalize pathnames, and hash cache-key inputs
     * @returns {void}
     */
    initialize(args) {
        const { contentAddressableStore, kvStore } = args ?? {};
        assert(kvStore, 'HyperviewService#initialize() requires a kvStore');
        assert(contentAddressableStore, 'HyperviewService#initialize() requires a contentAddressableStore');

        this.#contentAddressableStore = contentAddressableStore;
        this.#kvStore = kvStore;
    }

    // Compiles the site-wide partial bundle, which every render layers beneath
    // the page's own partials. Resolves an empty Map when no bundle is published.
    async #loadGlobalTemplatePartials(context, content) {
        // Check the bundle hash before fetching its bytes so a compiled-cache hit
        // avoids both the content read and template parsing.
        const stats = content.statGlobalTemplatePartials();

        if (!stats) {
            return new Map();
        }

        const cacheKey = stats.hash;
        if (this.#useTemplateCache && this.#globalPartials.has(cacheKey)) {
            return getCachedEntry(this.#globalPartials, cacheKey);
        }

        const file = await content.getGlobalTemplatePartials(context);

        const parts = file.pathname.split('/');
        parts.pop();
        const dirname = parts.join('/');

        const partials = new Map();

        assertArray(file.json, `Global template partials must be defined as an Array in "${ file.pathname }"`);

        for (const { id, source } of file.json) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from global partials in "${ file.pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from global partials in "${ file.pathname }"`,
            );

            const template = compileTemplate(`${ dirname }/${ id }`, source);
            partials.set(id, template);
        }

        if (this.#useTemplateCache) {
            // Retain several immutable bundle generations so a request pinned to an
            // older content snapshot can finish after a newer build is published.
            setCachedEntry(
                this.#globalPartials,
                cacheKey,
                partials,
                MAX_VERSIONED_TEMPLATE_CACHE_ENTRIES,
            );
        }

        return partials;
    }

    // Resolves one base template — the outer document a full-page render wraps
    // the page body in. Resolves undefined when the bundle names no such id, and
    // null when no bundle is published at all; the caller reports both the same way.
    async #loadBaseTemplate(context, content, templateId) {
        // Base templates are published as one bundle, so compile and cache the
        // complete map even though this call returns only the requested template.
        const stats = content.statBaseTemplates();

        if (!stats) {
            return null;
        }

        const cacheKey = stats.hash;
        if (this.#useTemplateCache && this.#baseTemplates.has(cacheKey)) {
            const map = getCachedEntry(this.#baseTemplates, cacheKey);
            return map.get(templateId);
        }

        const file = await content.getBaseTemplates(context);

        const parts = file.pathname.split('/');
        parts.pop();
        const dirname = parts.join('/');

        const templates = new Map();

        assertArray(file.json, `Base templates must be defined as an Array in "${ file.pathname }"`);

        for (const { id, source } of file.json) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from base templates in "${ file.pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from base templates in "${ file.pathname }"`,
            );

            const template = compileTemplate(`${ dirname }/${ id }`, source);
            templates.set(id, template);
        }

        if (this.#useTemplateCache) {
            // Retain several immutable bundle generations so a request pinned to an
            // older content snapshot can finish after a newer build is published.
            setCachedEntry(
                this.#baseTemplates,
                cacheKey,
                templates,
                MAX_VERSIONED_TEMPLATE_CACHE_ENTRIES,
            );
        }

        return templates.get(templateId);
    }

    // Compiles a page's own partial bundle. A page publishing no partials is
    // ordinary, so an absent bundle resolves an empty Map rather than failing.
    async #getPagePartials(file) {
        if (!file) {
            return new Map();
        }

        assertArray(
            file.json,
            `Page partials must be defined as an Array in "${ file.pathname }"`,
        );

        // The pathname preserves the partial's source identity in diagnostics;
        // the content hash invalidates only the page bundle whose bytes changed.
        const cacheKey = `${ file.pathname }#${ file.hash }`;

        if (this.#useTemplateCache && this.#pagePartials.has(cacheKey)) {
            return getCachedEntry(this.#pagePartials, cacheKey);
        }

        const parts = file.pathname.split('/');
        parts.pop();
        const dirname = parts.join('/');

        const partials = new Map();

        for (const { id, source } of file.json) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from page partials in "${ file.pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from page partials in "${ file.pathname }"`,
            );

            const template = compileTemplate(`${ dirname }/${ id }`, source);
            partials.set(id, template);
        }

        if (this.#useTemplateCache) {
            // Keep older compiled versions available for requests pinned to the
            // corresponding immutable content snapshots.
            setCachedEntry(
                this.#pagePartials,
                cacheKey,
                partials,
                MAX_PAGE_PARTIAL_CACHE_ENTRIES,
            );
        }

        return partials;
    }

    // Compiles the page's own template. Unlike the bundles this one is required:
    // #getPage() has already established the page has a template blob.
    async #getPageTemplate(file) {
        assertNonEmptyString(
            file.text,
            `expects template.text to be present from "${ file.pathname }"`,
        );

        // A pathname alone would serve stale output after publication; retaining
        // the hash also lets an in-flight request finish with the previous version.
        const cacheKey = `${ file.pathname }#${ file.hash }`;

        if (this.#useTemplateCache && this.#pageTemplates.has(cacheKey)) {
            return getCachedEntry(this.#pageTemplates, cacheKey);
        }

        const template = compileTemplate(file.pathname, file.text);

        if (this.#useTemplateCache) {
            // Keep older compiled versions available for requests pinned to the
            // corresponding immutable content snapshots.
            setCachedEntry(
                this.#pageTemplates,
                cacheKey,
                template,
                MAX_PAGE_TEMPLATE_CACHE_ENTRIES,
            );
        }

        return template;
    }

    // Reads every asset one page render needs in a single bulk fetch, compiles
    // its templates, and hands the pieces to HyperviewPage for context assembly.
    // Resolves null when there is no renderable page at this pathname.
    #getStaticAssets(content) {
        const stats = content.statStaticAssets();
        const cacheKey = stats?.hash ?? '';

        if (this.#staticAssets.has(cacheKey)) {
            return getCachedEntry(this.#staticAssets, cacheKey);
        }

        const assets = Object.fromEntries(content.listStaticAssets().map(({ pathname, hash }) => {
            return [ pathname, hash ];
        }));

        return setCachedEntry(this.#staticAssets, cacheKey, assets, MAX_VERSIONED_TEMPLATE_CACHE_ENTRIES);
    }

    async #getPage(context, content, url, pathname, responseProps, assets) {
        const page = await content.batchGetPageAssets(context, pathname);

        // A page directory can carry metadata with no template of its own; an ancestor
        // directory published only to supply inherited defaults for its descendants.
        // Requesting that pathname directly is a missing resource from the caller's
        // perspective, so we return null as if the page itself was not found.
        if (!page || !page.template) {
            return null;
        }

        // The snapshot returns metadata from the broadest ancestor to the leaf;
        // HyperviewPage relies on that order when applying merge precedence.
        const pageDataSources = page.pageDataFiles.map((file) => file.json);
        // Started together so the two compilations overlap; both must be awaited
        // before HyperviewPage stores them, because it keeps what it is given verbatim.
        const [ partials, template ] = await Promise.all([
            this.#getPagePartials(page.partials),
            this.#getPageTemplate(page.template),
        ]);

        return new HyperviewPage({
            url,
            pathname,
            responseProps,
            assets,
            pageDataSources,
            template,
            partials,
            includes: page.includes?.json ?? {},
            hash: page.hash,
            createMiniTemplate: this.createMiniTemplate.bind(this),
        });
    }

    // Compiles an email bundle: the subject metadata plus whichever of the HTML
    // and text representations were published, and the bundle's own partials.
    // Nothing here is cached, because emails are rendered far less often than
    // pages and there is no request-rate pressure to justify the retained memory.
    async #getEmail(context, content, pathname) {
        const bundle = await content.getEmailAssets(context, pathname);

        if (!bundle) {
            return null;
        }

        // HTML and text are independent representations; an email may publish
        // either one without requiring the other.
        let htmlTemplate;
        if (bundle.json.htmlTemplate) {
            const { id, source } = bundle.json.htmlTemplate;
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from email HTML template in "${ pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from email HTML template in "${ pathname }"`,
            );
            htmlTemplate = compileTemplate(id, source);
        }
        let textTemplate;
        if (bundle.json.textTemplate) {
            const { id, source } = bundle.json.textTemplate;
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from email text template in "${ pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from email text template in "${ pathname }"`,
            );
            textTemplate = compileTemplate(id, source);
        }

        const partials = new Map();

        if (bundle.json.partials) {
            assertArray(bundle.json.partials, `Email template partials must be defined as an Array in "${ pathname }"`);

            for (const { id, source } of bundle.json.partials) {
                assertNonEmptyString(
                    id,
                    `Missing or invalid "id" from email partials in "${ pathname }"`,
                );
                assertNonEmptyString(
                    source,
                    `Missing or invalid "source" from email partials in "${ pathname }"`,
                );

                const template = compileTemplate(`${ pathname }/${ id }`, source);
                partials.set(id, template);
            }
        }

        return {
            contextData: bundle.json.contextData ?? {},
            htmlTemplate,
            textTemplate,
            partials,
            includes: bundle.json.includes ?? {},
            hash: bundle.hash,
        };
    }


    /**
     * Renders assembled page-context JSON, a page partial, a page template, or a
     * complete page wrapped by a base template. All content and cache-validator
     * reads use one immutable, request-scoped content snapshot.
     *
     * @param {import('../context/request-context.js').default} context - Context for storage and cache operations
     * @param {Object} options - Render inputs independent of HTTP request and response objects
     * @param {URL} options.url - Requested URL used to select the page and default cache identity
     * @param {Object} options.props - Plain runtime template props merged over published page metadata
     * @param {string} [options.pathname] - Canonical page identifier; defaults to the normalized URL pathname
     * @param {string} [options.baseTemplateId] - Canonical base template identifier required for full-page rendering
     * @param {string} [options.partial] - Canonical page-partial identifier to render instead of the page and base templates
     * @param {boolean} [options.skipBaseRender=false] - Render the page template without its base template
     * @param {boolean} [options.usePageCache] - Enable rendered-page cache preparation, reads, and writes; defaults to the constructor value
     * @param {string} [options.cacheKey] - Cache identity component used only when page caching is enabled; defaults to request origin, pathname, and query string, then becomes part of an opaque hashed KV key
     * @param {boolean} [options.includePropsInCacheKey] - Include runtime props in the rendered-page cache identity; defaults to true when page caching is enabled and false otherwise
     * @param {function(string, Object, Object): (string|Promise<string>)} [options.propsHashFunction] - Returns the runtime-props hash from the page pathname, merged page context, and runtime props; used only when page caching and props-sensitive keys are enabled
     * @param {number} [options.pageCacheReadTtlSeconds] - Cache TTL passed to enabled page-cache reads; defaults to the constructor value
     * @param {number} [options.pageCacheExpirationSeconds] - Expiration passed to enabled page-cache writes; defaults to the constructor value
     * @param {boolean} [options.allowJsonResponse] - Serve assembled page context for explicit JSON requests and treat `.json` as a representation suffix; defaults to the constructor value
     * @returns {Promise<{type: 'hypertext', hypertext: string}|{type: 'page-context', pageContext: Object}>} Rendered representation, without HTTP response state
     * @throws {NotFoundError} When no page exists for the resolved pathname
    */
    async renderPage(context, options) {
        assert(isPlainObject(options), 'HyperviewService#renderPage: options must be a plain object');
        const { props, url } = options;

        assert(url instanceof URL, 'HyperviewService#renderPage: options.url must be a URL');
        assert(isPlainObject(props), 'HyperviewService#renderPage: options.props must be a plain object');

        // Each caller may override the constructor-level default for its own call.
        const usePageCache = options.usePageCache ?? this.#usePageCache;
        const pageCacheReadTtlSeconds = options.pageCacheReadTtlSeconds ?? this.#pageCacheReadTtlSeconds;
        const pageCacheExpirationSeconds = options.pageCacheExpirationSeconds ?? this.#pageCacheExpirationSeconds;
        const allowJsonResponse = options.allowJsonResponse ?? this.#allowJsonResponse;

        // If page cache is turned on, then we want to include props in the cache key
        // by default. Otherwise we could cache and serve a page intended for a
        // specific user to a different user without explicitly
        // overriding includePropsInCacheKey.
        let includePropsInCacheKey = false;
        if (usePageCache) {
            if (isUndefined(options.includePropsInCacheKey)) {
                includePropsInCacheKey = true;
            } else {
                includePropsInCacheKey = options.includePropsInCacheKey;
            }
        }

        // Gate the ".json" extension on allowJsonResponse here, because this flag also
        // decides whether the extension is stripped from the pathname. Ungated, a
        // ".json" request would resolve the page at the extensionless pathname
        // and render it as HTML whenever JSON responses are disabled, exposing
        // every page under a second, non-canonical URL instead of
        // reporting it as not found.
        const isJsonPathRequest = allowJsonResponse && url.pathname.toLowerCase().endsWith('.json');

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;

            assert(
                this.#contentAddressableStore.isValidPathname(pathname),
                'HyperviewService#renderPage: options.pathname',
            );
        } else {
            let requestPathname = url.pathname;
            if (isJsonPathRequest) {
                // Slicing by length rather than matching on ".json" literally, so
                // this strips whichever case of the extension isJsonPathRequest matched.
                requestPathname = requestPathname.slice(0, -'.json'.length);
                // "index" names a directory page at every depth, not a page called
                // "index", so drop the segment and let normalizePathname() fold the
                // trailing slash. Matching only "/index" would leave the ".json"
                // affordance broken for every directory page below the root.
                if (requestPathname.endsWith('/index')) {
                    requestPathname = requestPathname.slice(0, -'index'.length);
                }
            }
            pathname = this.#contentAddressableStore.normalizePathname(requestPathname);

            // The URL is external input. Unsupported content-store characters
            // mean no page can exist at this pathname; they are not an internal
            // rendering-contract failure.
            if (!this.#contentAddressableStore.isValidPathname(pathname)) {
                throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                    url: url.href,
                    pathname,
                });
            }
        }

        // We need to assert these identifiers are correct and safe here, because they
        // may not have been checked prior to reaching this routine.
        if (options.partial) {
            assert(
                this.#contentAddressableStore.isValidPathname(options.partial),
                'HyperviewService#renderPage: options.partial',
            );
        } else if (!options.skipBaseRender) {
            assert(
                this.#contentAddressableStore.isValidPathname(options.baseTemplateId),
                'HyperviewService#renderPage options.baseTemplateId',
            );
        }

        // A render reads all of its content, including cache-key inputs, through
        // exactly one request-scoped snapshot.
        const content = await this.#contentAddressableStore.openSnapshot(context);

        const assets = this.#getStaticAssets(content);
        const page = await this.#getPage(context, content, url, pathname, props, assets);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        // Serve JSON only when the deployment allows it and the client asked for
        // it, by the ".json" path extension. This branch precedes the page cache
        // deliberately: the context is cheap to serialize, and caching it would
        // put a second representation of every page in the shared cache.
        if (isJsonPathRequest) {
            // The optional JSON response is intended for development and debugging.
            // It exposes the assembled context, including merged runtime props,
            // so deployments serving authenticated pages leave it disabled.
            return { type: 'page-context', pageContext: page.context };
        }

        let pageCacheKey;
        let hypertext;

        // Disabling the rendered-page cache also skips its storage stats and
        // hashing; compiled-template cache validation remains in the loaders.
        if (usePageCache) {
            // page.hash covers every file the page render read, but not the shared
            // bundles layered over it, so an edit to a global partial would
            // otherwise keep serving the old output.
            const partials = content.statGlobalTemplatePartials();
            const staticAssets = content.statStaticAssets();
            let hash = await this.#contentAddressableStore.hashString(
                `${ page.hash }#${ partials?.hash ?? '' }#${ staticAssets?.hash ?? '' }`,
            );

            // Optionally add the hash of the canonicalized props object.
            if (includePropsInCacheKey) {
                let propsHash;
                if (isFunction(options.propsHashFunction)) {
                    propsHash = await options.propsHashFunction(
                        page.pathname,
                        page.context,
                        props,
                    );
                } else {
                    propsHash = await this.#contentAddressableStore.hashSet(props);
                }
                hash = await this.#contentAddressableStore.hashString(`${ hash }#${ propsHash }`);
            }

            // If the caller does not provide a custom cache key, we use the URL
            // origin + pathname + query params as the default.
            const pageCacheIdentity = isNonEmptyString(options.cacheKey)
                ? options.cacheKey
                : (url.origin + url.pathname + url.search);

            // The three render modes produce different output for one URL, so the
            // mode is part of the identity. Only a full-page render depends on the
            // base template bundle, so only that branch folds its hash in.
            let renderModeIdentity;

            if (options.partial) {
                renderModeIdentity = `PARTIAL#${ options.partial }`;
            } else if (options.skipBaseRender) {
                renderModeIdentity = 'PAGE_TEMPLATE_ONLY';
            } else {
                const baseTemplates = content.statBaseTemplates();
                hash = await this.#contentAddressableStore.hashString(`${ hash }#${ baseTemplates?.hash ?? '' }`);
                renderModeIdentity = `FULL_PAGE#${ options.baseTemplateId }`;
            }

            // The logical identity can be arbitrarily large (full URL, query string,
            // custom cache key) and may contain sensitive query-string values, so it
            // is never used as the KV key or logged directly. Hashing it into a short,
            // opaque, fixed-length key also keeps every key within the portable
            // 512-byte KV key limit regardless of the input size.
            const logicalCacheIdentity = await this.#contentAddressableStore.hashString(
                `${ pageCacheIdentity }#${ renderModeIdentity }#${ hash }`,
            );
            pageCacheKey = `hyperview_page_cache#${ logicalCacheIdentity }`;

            hypertext = await this.#kvStore.get(context, pageCacheKey, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { url: url.href, pathname, key: pageCacheKey });
                return { type: 'hypertext', hypertext };
            }
            this.#logger.info('cached page miss', { url: url.href, pathname, key: pageCacheKey });
        }

        if (options.partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            this.#logger.debug('render partial for page', { pathname, url: url.href, partial: options.partial });

            const globalPartials = await this.#loadGlobalTemplatePartials(context, content);
            const template = page.partials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.context, layerPartials(page.partials, globalPartials));

            // Empty output is treated as a render failure rather than a valid
            // response: it means a template resolved nothing, and caching it would
            // pin the blank result for the life of the cache entry.
            assertNonEmptyString(
                hypertext,
                `HyperviewService rendered empty hypertext for the partial "${ options.partial }" render of page "${ pathname }"`,
            );

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return { type: 'hypertext', hypertext };
        }

        if (options.skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            this.#logger.debug('skip base template render for page', { url: url.href, pathname });

            const template = page.template;
            const globalPartials = await this.#loadGlobalTemplatePartials(context, content);

            hypertext = template(page.context, layerPartials(page.partials, globalPartials));
            assertNonEmptyString(
                hypertext,
                `HyperviewService rendered empty hypertext for page template render of page "${ pathname }"`,
            );

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return { type: 'hypertext', hypertext };
        }

        const baseTemplate = await this.#loadBaseTemplate(context, content, options.baseTemplateId);

        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.context;
        const globalPartials = await this.#loadGlobalTemplatePartials(context, content);
        const partials = layerPartials(page.partials, globalPartials);

        // Render the page body first and expose it through the shared context so
        // the base template can compose the complete document around it. This
        // mutates the page context, which is why the two templates render against
        // the same object rather than a copy: the base template needs to see it.
        pageContext.body = page.template(pageContext, partials);
        hypertext = baseTemplate(pageContext, partials);
        assertNonEmptyString(
            hypertext,
            `HyperviewService rendered empty hypertext for full page render of page "${ pathname }"`,
        );

        if (usePageCache) {
            await this.#kvStore.put(context, pageCacheKey, hypertext, {
                type: 'text',
                ttlSeconds: pageCacheExpirationSeconds,
            });
        }

        return { type: 'hypertext', hypertext };
    }

    /**
     * Renders the available subject, HTML body, and plain-text body for an email.
     * Caller props override static email context data, and every content read uses
     * one immutable, request-scoped content snapshot.
     *
     * The HTML and text bodies are independent representations: a bundle may
     * publish either one, and the unpublished field resolves null so the caller
     * can decide which variants to send without inspecting the source assets.
     * Unlike page rendering, nothing here is cached or reused between calls.
     * @param {import('../context/request-context.js').default} context - Context for content access
     * @param {string} pathname - Canonical pathname identifying the email content
     * @param {Object} props - Runtime values merged into the email template context
     * @returns {Promise<{subject: string|null, html: string|null, text: string|null}>} Rendered email fields; unavailable fields are null
     * @throws {NotFoundError} When no email bundle is published at the pathname
     */
    async renderEmail(context, pathname, props) {
        assert(
            this.#contentAddressableStore.isValidPathname(pathname),
            'HyperviewService#renderEmail: pathname',
        );

        // A render reads all of its content, including cache-key inputs, through
        // exactly one request-scoped snapshot.
        const content = await this.#contentAddressableStore.openSnapshot(context);

        const email = await this.#getEmail(context, content, pathname);

        // An unpublished pathname is an ordinary outcome, not a programmer error;
        // report it the same way renderPage() reports a missing page.
        if (!email) {
            throw new NotFoundError(`No email found for pathname "${ pathname }"`, { pathname });
        }

        const globalPartials = await this.#loadGlobalTemplatePartials(context, content);
        const partials = layerPartials(email.partials, globalPartials);

        // Runtime values take precedence over published defaults so callers can
        // supply recipient- and delivery-specific data.
        //
        // deepMerge() mutates its target, and the target here is the bundle's own
        // contextData. That is only safe because #getEmail() parses the bundle
        // fresh on every call; caching email bundles would leak one recipient's
        // props into the next render.
        const contextData = deepMerge(email.contextData, { includes: email.includes }, props);

        let subject = null;
        let html = null;
        let text = null;

        // Subject metadata supports template syntax without gaining access to
        // partials, matching the same constraint as page title metadata.
        if (isNonEmptyString(contextData.subject?.template)) {
            const subjectTemplate = this.createMiniTemplate(`${ pathname }.subject`, contextData.subject.template);
            subject = subjectTemplate(contextData);
        } else {
            subject = contextData.subject;
        }
        // Preserve null for an unpublished representation so callers can decide
        // which body variants to send without inspecting the source assets.
        if (email.htmlTemplate) {
            html = email.htmlTemplate(contextData, partials);
        }
        if (email.textTemplate) {
            text = email.textTemplate(contextData, partials);
        }

        return { subject, html, text };
    }

    /**
     * Compiles template syntax for metadata fields which do not support partials,
     * such as page titles, descriptions, and email subject lines.
     *
     * The returned function is bound to an empty partial lookup, so a `{{> name }}`
     * in one of these fields expands to nothing — a missing partial renders as an
     * empty string, per the Mustache spec. Metadata is interpolated into
     * attributes, headers, and subject lines where a partial's markup would be
     * meaningless. Custom helpers remain available.
     * @param {string} templateId - Identifier included in template error messages
     * @param {string} templateSource - Template source to compile
     * @returns {function(Object): string} Render function accepting the template context
     */
    createMiniTemplate(templateId, templateSource) {
        const template = compileTemplate(templateId, templateSource);
        // An empty lookup deliberately prevents metadata templates from resolving
        // page or global partials.
        return (data) => template(data, new Map());
    }
}
