
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

export default class HyperviewService {

    #customHelpers = new Map([
        [ 'formatDate', formatDate ],
        [ 'markup', markup ],
        [ 'truncate', truncate ],
    ]);

    // Immutable compiled page partials, indexed by their content bundle etags.
    #pagePartials = new Map();

    // Immutable compiled page templates, indexed by normalized template filepath.
    #pageTemplates = new Map();

    #useTemplateCache;
    #usePageCache;

    #allowJsonResponse;

    #pageCacheReadTtlSeconds;
    #pageCacheExpirationSeconds;

    #logger;
    #contentStore;
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
     * Connects the dependencies required for content loading and rendered-page caching.
     * @param {Object} args - Service dependencies
     * @param {import('../key-value-store/key-value-store-interface.js').KeyValueStoreInterface} args.kvStore - Key-value store for rendered hypertext
     * @param {import('../content-addressable-store/content-addressable-store.js').default} args.contentStore - A ContentAddressableStore interface
     * @returns {void}
     */
    initialize(args) {
        const { contentStore, kvStore } = args ?? {};
        assert(kvStore, 'HyperviewService#initialize() requires a kvStore');
        assert(contentStore, 'HyperviewService#initialize() requires a contentStore');

        this.#contentStore = contentStore;
        this.#kvStore = kvStore;
    }

    async #getPagePartials(file) {
        if (!file) {
            return new Map();
        }

        assertNonEmptyString(
            file.hash,
            `expects partials.hash to be present from "${ file.pathname }"`,
        );
        assertArray(
            file.json,
            `expects partials.json to be present from "${ file.pathname }"`,
        );

        const cacheKey = `${ file.pathname }#${ file.hash }`;

        if (this.#useTemplateCache && this.#pagePartials.has(cacheKey)) {
            return getCachedEntry(this.#pagePartials, cacheKey);
        }

        const pagePartials = new Map();

        for (const { id, source } of file.json) {
            assertNonEmptyString(
                id,
                `Missing or invalid "id" from page partials in "${ file.pathname }"`,
            );
            assertNonEmptyString(
                source,
                `Missing or invalid "source" from page partials in "${ file.pathname }"`,
            );

            const template = compileTemplate(id, source, this.#customHelpers);
            pagePartials.set(id, template);
        }

        if (this.#useTemplateCache) {
            setCachedEntry(
                this.#pagePartials,
                cacheKey,
                pagePartials,
                MAX_PAGE_PARTIAL_CACHE_ENTRIES,
            );
        }

        return pagePartials;
    }

    async #getPageTemplate(file) {
        assertNonEmptyString(
            file.hash,
            `expects template.hash to be present from "${ file.pathname }"`,
        );
        assertArray(
            file.text,
            `expects template.json to be present from "${ file.pathname }"`,
        );

        const cacheKey = `${ file.pathname }#${ file.hash }`;

        if (this.#useTemplateCache && this.#pageTemplates.has(cacheKey)) {
            return getCachedEntry(this.#pageTemplates, cacheKey);
        }

        const template = compileTemplate(file.pathname, file.text, this.#customHelpers);

        if (this.#useTemplateCache) {
            setCachedEntry(
                this.#pageTemplates,
                cacheKey,
                template,
                MAX_PAGE_TEMPLATE_CACHE_ENTRIES,
            );
        }

        return template;
    }

    async #getPage(content, url, pathname, responseProps) {
        const page = await content.batchGetPageAssets(pathname);

        // A page directory can carry metadata with no template of its own; an ancestor
        // directory published only to supply inherited defaults for its descendants.
        // Requesting that pathname directly is a missing resource from the caller's
        // perspective, so we return null as if the page itself was not found.
        if (!page || !page.template) {
            return null;
        }

        const pageDataSources = page.pageDataFiles.map((file) => file.json);
        const partials = this.#getPagePartials(page.partials);
        const template = this.#getPageTemplate(page.template);

        return new HyperviewPage({
            url,
            pathname,
            responseProps,
            pageDataSources,
            template,
            partials,
            includes: page.includes || {},
            hash: page.hash,
            createMiniTemplate: createMiniTemplate.bind(this),
        });
    }

    async respondWithHypertext(context, request, response, options) {
        options = options ?? {};

        // Each caller may override the constructor-level default for its own call.
        const usePageCache = options.usePageCache ?? this.#usePageCache;
        const pageCacheReadTtlSeconds = options.pageCacheReadTtlSeconds ?? this.#pageCacheReadTtlSeconds;
        const pageCacheExpirationSeconds = options.pageCacheExpirationSeconds ?? this.#pageCacheExpirationSeconds;

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

        const allowJsonResponse = options.allowJsonResponse ?? this.#allowJsonResponse;

        // Gate the ".json" extension on allowJsonResponse here, because this flag also
        // decides whether the extension is stripped from the pathname. Ungated, a
        // ".json" request would resolve the page at the extensionless pathname
        // and render it as HTML whenever JSON responses are disabled, exposing
        // every page under a second, non-canonical URL instead of
        // reporting it as not found.
        const isJsonPathRequest = allowJsonResponse && request.url.pathname.toLowerCase().endsWith('.json');

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            let requestPathname = request.url.pathname;
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
            pathname = normalizePathname(requestPathname);
        }

        assert(
            isValidPathname(pathname),
            'HyperviewService#respondWithHypertext: pathname',
        );

        // We need to assert these identifiers are correct and safe here, because they
        // may not have been checked prior to reaching this routine.
        if (options.partial) {
            assert(
                isValidPathname(options.partial),
                'HyperviewService#respondWithHypertext: options.partial',
            );
        } else if (!options.skipBaseRender) {
            assert(
                isValidPathname(options.baseTemplateId),
                'HyperviewService#respondWithHypertext options.baseTemplateId',
            );
        }

        const { url } = request;

        // A render reads all of its content, including cache-key inputs, through
        // exactly one request-scoped snapshot.
        const content = await this.#contentStore.openSnapshot(context);

        const page = await this.#getPage(content, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        // Serve JSON only when the deployment allows it and the client asked for
        // it, by the ".json" path extension.
        if (isJsonPathRequest) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.context,
                { whiteSpace: 4 },
            );
        }

        let pageCacheKey;
        let hypertext;

        // Disabling the rendered-page cache also skips its storage stats and
        // hashing; compiled-template cache validation remains in the loaders.
        if (usePageCache) {
            const partials = content.statGlobalTemplatePartials();
            let hash = await hashValue(`${ page.hash }#${ partials?.hash ?? '' }`);

            // Optionally add the hash of the canonicalized props object.
            if (includePropsInCacheKey) {
                let propsHash;
                if (isFunction(options.propsHashFunction)) {
                    propsHash = await options.propsHashFunction(
                        page.pathname,
                        page.context,
                        response.props,
                    );
                } else {
                    propsHash = await hashValue(response.props);
                }
                hash = await hashValue(`${ hash }#${ propsHash }`);
            }

            // If the caller does not provide a custom cache key, we use the URL
            // origin + pathname + query params as the default.
            const pageCacheIdentity = isNonEmptyString(options.cacheKey)
                ? options.cacheKey
                : (url.origin + url.pathname + url.search);

            let renderModeIdentity;

            if (options.partial) {
                renderModeIdentity = `PARTIAL#${ options.partial }`;
            } else if (options.skipBaseRender) {
                renderModeIdentity = 'PAGE_TEMPLATE_ONLY';
            } else {
                const baseTemplates = content.statBaseTemplates();
                hash = await hashValue(`${ hash }#${ baseTemplates?.hash ?? '' }`);
                renderModeIdentity = `FULL_PAGE#${ options.baseTemplateId }`;
            }

            // The logical identity can be arbitrarily large (full URL, query string,
            // custom cache key) and may contain sensitive query-string values, so it
            // is never used as the KV key or logged directly. Hashing it into a short,
            // opaque, fixed-length key also keeps every key within the portable
            // 512-byte KV key limit regardless of the input size.
            const logicalCacheIdentity = await hashValue(`${ pageCacheIdentity }#${ renderModeIdentity }#${ hash }`);
            pageCacheKey = `hyperview_page_cache#${ logicalCacheIdentity }`;

            hypertext = await this.#kvStore.get(context, pageCacheKey, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { url: url.href, pathname, key: pageCacheKey });
                return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
            }
            this.#logger.info('cached page miss', { url: url.href, pathname, key: pageCacheKey });
        }

        if (options.partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            this.#logger.debug('render partial for page', { pathname, url: url.href, partial: options.partial });

            const globalPartials = await this.#loadGlobalPartials(content);
            const template = page.partials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.context, layerPartials(pagePartials, globalPartials));
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

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        if (options.skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            this.#logger.debug('skip base template render for page', { url: url.href, pathname });

            const template = page.template;
            const globalPartials = await this.#loadGlobalPartials(content);

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

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        const baseTemplate = await this.#loadBaseTemplate(content, options.baseTemplateId);

        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.context;
        const globalPartials = await this.#loadGlobalPartials(content);
        const partials = layerPartials(page.partials, globalPartials);

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

        return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
    }

    async renderEmail(context, pathname, props) {
        assert(
            isValidPathname(pathname),
            'HyperviewService#renderEmail: pathname',
        );

        // A render reads all of its content, including cache-key inputs, through
        // exactly one request-scoped snapshot.
        const content = await this.#contentStore.openSnapshot(context);

        const email = await getEmail(content, pathname, props);

        const globalPartials = await this.#loadGlobalPartials(content);
        const emailPartials = email.getPartials();
        const partials = layerPartials(emailPartials, globalPartials);

        return email.render(partials);
    }
}
