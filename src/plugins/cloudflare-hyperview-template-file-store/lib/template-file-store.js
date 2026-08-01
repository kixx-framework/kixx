import {
    AssertionError,
    assert,
    assertArray,
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

const BASE_TEMPLATE_PREFIX = 'base/';
const PAGE_TEMPLATE_PREFIX = 'pages/';
const PARTIALS_PREFIX = 'partials/';
const PARTIALS_MANIFEST_FILENAME = 'partials.json';
const DEFAULT_BINDING_NAME = 'HYPERVIEW_TEMPLATE_FILE_STORE';

// Namespaced template keys are immutable: HyperviewService refuses any template
// write whose target build id matches the live one, so a deploy always writes a
// *different* set of keys. A stale read is therefore impossible and the TTL can
// be long enough that a build's templates stay warm between deploys.
const DEFAULT_CACHE_TTL_SECONDS = 86400;

// Without a namespace, reads fall to the flat keyspace, where nothing stops a
// key from being overwritten in place — the immutability argument above does not
// hold. Cap the TTL there at the same order as page data so a flat-keyspace
// deployment does not have to wait a day to see an edited template.
const MAX_UNNAMESPACED_CACHE_TTL_SECONDS = 300;

// Cloudflare KV rejects a cacheTtl below 30 seconds.
const MIN_CACHE_TTL_SECONDS = 30;

/**
 * Cloudflare KV-backed store for shared Hyperview templates.
 *
 * Base template ids are resolved relative to `base/` and page template ids
 * relative to `pages/`; partials are loaded from `partials/` and returned with
 * their full logical filepath for downstream name normalization.
 *
 * Every read and write method accepts an optional `namespace`. When provided, KV
 * keys are namespaced as `{namespace}/{key}` so that multiple versions of a build
 * can coexist in the same KV namespace and deployments stay idempotent. When the
 * namespace is omitted, keys are stored at the flat, unprefixed namespace —
 * which supports use cases which do *not* use idempotent deployments.
 * Callers always work with logical filepaths; the namespace prefix is applied
 * and stripped internally, and keeping the read and write
 * namespaces consistent is the caller's responsibility.
 *
 * Reads pass an explicit `cacheTtl` so template keys stay warm in the network
 * location they were read from for far longer than Cloudflare's 60 second
 * default, which is what keeps cold-key latency off the page render path. A
 * namespaced key is immutable for the life of its build, so the TTL there is
 * long; an un-namespaced key can be overwritten in place and is capped much
 * lower. The long TTL is configurable through
 * `config.env.HYPERVIEW_TEMPLATE_FILE_STORE.cacheTtl`.
 *
 * A namespaced partial set is stored as one JSON manifest value at
 * `{namespace}/partials.json`, mapping prefix-included logical filepaths (e.g.
 * `partials/nav.html`) to source strings, so a namespaced `getPartials()`
 * loads the complete set through one cacheable `get()` rather than an
 * uncacheable `list()` plus a bulk read. `putPartials()` replaces the whole
 * manifest value in one call; it never writes or reads the individual
 * `{namespace}/partials/...` keys used before this format existed, and does
 * not migrate or delete them. Without a namespace, `getPartials()` still
 * performs an uncacheable `list()` before its bulk read, because Cloudflare
 * KV's list operation accepts no `cacheTtl` and there is no single manifest
 * key to address in the flat, unprefixed keyspace.
 *
 * @implements {import('../../../kixx/hyperview/template-file-store-interface.js').TemplateFileStoreInterface}
 */
export default class TemplateFileStore {

    #logger = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a TemplateFileStore child logger
     * @throws {Error} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'TemplateFileStore requires a logger');
        this.#logger = logger.createChild('TemplateFileStore');
    }

    /**
     * Retrieves a base template source file from the shared template KV store.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Base template filename relative to `base/`
     * @returns {Promise<{filepath: string, source: string}|null>} Resolves to template source with logical filepath, or null when missing
     */
    async getBaseTemplate(context, namespace, filepath) {
        return await this.#getFile(context, namespace, BASE_TEMPLATE_PREFIX, filepath);
    }

    /**
     * Writes (creates or updates) a base template source file in the shared
     * template KV store under the optional namespace.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Base template filename relative to `base/`
     * @param {string} source - Template source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putBaseTemplate(context, namespace, filepath, source) {
        return await this.#putFile(context, namespace, BASE_TEMPLATE_PREFIX, filepath, source);
    }

    /**
     * Retrieves a page template source file from the shared template KV store.
     * The filepath may be nested several segments deep, delimited by `/`.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Page template filepath relative to `pages/`
     * @returns {Promise<{filepath: string, source: string}|null>} Resolves to template source with logical filepath, or null when missing
     */
    async getPageTemplate(context, namespace, filepath) {
        return await this.#getFile(context, namespace, PAGE_TEMPLATE_PREFIX, filepath);
    }

    /**
     * Writes (creates or updates) a page template source file in the shared
     * template KV store under the optional namespace. The filepath may be nested
     * several segments deep, delimited by `/`.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Page template filepath relative to `pages/`
     * @param {string} source - Template source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putPageTemplate(context, namespace, filepath, source) {
        return await this.#putFile(context, namespace, PAGE_TEMPLATE_PREFIX, filepath, source);
    }

    /**
     * Replaces the complete partial template set for the required `namespace`,
     * storing it as one JSON manifest value rather than one KV key per partial.
     * A successful call overwrites any previously published manifest for
     * `namespace` in a single KV `put()`; a failed call may leave the previous
     * manifest, a partially written value, or nothing at all, and concurrent
     * calls for the same `namespace` are not ordered by this method.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string} namespace - Required namespace (build id) that scopes the manifest key
     * @param {import('../../../kixx/hyperview/template-file-store-interface.js').PartialInput[]} partials - Complete partial set to publish, with filepaths relative to `partials/`
     * @returns {Promise<{filepath: string}[]>} Resolves with the logical, `partials/`-prefixed filepaths that were written, in submitted order
     * @throws {AssertionError} When namespace is empty or invalid, partials is not an array, or an entry's filepath or source is invalid
     * @throws {OperationalError} When the KV write fails
     */
    async putPartials(context, namespace, partials) {
        const safeNamespace = this.#resolveNamespace(namespace);
        assertNonEmptyString(safeNamespace, 'TemplateFileStore putPartials requires a non-empty namespace');
        assertArray(partials, 'TemplateFileStore putPartials requires an array of partials');

        const manifest = {};
        const refs = [];

        for (const { filepath, source } of partials) {
            assertNonEmptyString(filepath, 'TemplateFileStore putPartials requires a filepath for every entry');
            assertNonEmptyString(source, 'TemplateFileStore putPartials requires source text for every entry');
            // Reject path traversal so a client cannot escape its prefix or the namespace.
            assert(
                !filepath.split('/').includes('..'),
                'TemplateFileStore putPartials filepath must not contain ".." segments',
            );

            const logicalKey = `${ PARTIALS_PREFIX }${ filepath.replace(/^\//, '') }`;
            manifest[logicalKey] = source;
            refs.push({ filepath: logicalKey });
        }

        const manifestKey = this.#manifestKey(safeNamespace);
        const kvStore = this.#getKVStore(context);
        this.#logger.debug('putPartials() writing manifest', { key: manifestKey, count: refs.length });

        try {
            await kvStore.put(manifestKey, JSON.stringify(manifest));
        } catch (cause) {
            throw new OperationalError(
                `TemplateFileStore failed to write partial manifest "${ manifestKey }"`,
                { cause },
            );
        }

        return refs;
    }

    /**
     * Retrieves all available partial templates from the shared template KV
     * store. With a non-empty `namespace`, loads the complete set through one
     * cacheable manifest `get()`; a namespace that was never published by
     * `putPartials()` is an invariant failure, and an explicitly published
     * empty set resolves to `[]`. Without a namespace, falls back to the flat,
     * unprefixed `list()` plus bulk-read behavior.
     * @param {RequestContext} context - Request context exposing the configured KV binding
     * @param {string|null} [namespace] - Optional namespace used to select the manifest or the flat listing
     * @returns {Promise<{filepath: string, source: string}[]>} Resolves to existing partial source files with logical filepaths
     * @throws {AssertionError} When a non-empty namespace's manifest is missing or structurally invalid
     * @throws {OperationalError} When the KV read fails
     */
    async getPartials(context, namespace) {
        const safeNamespace = this.#resolveNamespace(namespace);

        if (!safeNamespace) {
            return await this.#loadPrefixedFiles(context, namespace, PARTIALS_PREFIX);
        }

        return await this.#loadPartialsManifest(context, safeNamespace);
    }

    async #getFile(context, namespace, barePrefix, filepath) {
        const { logicalKey, kvKey } = this.#resolveKey(namespace, barePrefix, filepath);
        const cacheTtl = this.#resolveCacheTtl(context, namespace);
        this.#logger.debug('getFile() loading key', { key: kvKey, cacheTtl });
        const kvStore = this.#getKVStore(context);

        let source;
        try {
            source = await kvStore.get(kvKey, { type: 'text', cacheTtl }) ?? null;
        } catch (cause) {
            throw new OperationalError(
                `TemplateFileStore failed to read KV key "${ kvKey }"`,
                { cause },
            );
        }

        if (source !== null) {
            return { filepath: logicalKey, source };
        }

        return null;
    }

    async #putFile(context, namespace, barePrefix, filepath, source) {
        assertNonEmptyString(filepath, 'TemplateFileStore write requires a filepath');
        assertNonEmptyString(source, 'TemplateFileStore write requires source text');
        // Reject path traversal so a client cannot escape its prefix or the namespace.
        assert(
            !filepath.split('/').includes('..'),
            'TemplateFileStore write filepath must not contain ".." segments',
        );

        const { logicalKey, kvKey } = this.#resolveKey(namespace, barePrefix, filepath);
        this.#logger.debug('putFile() writing key', { key: kvKey });
        const kvStore = this.#getKVStore(context);

        try {
            await kvStore.put(kvKey, source);
        } catch (cause) {
            throw new OperationalError(
                `TemplateFileStore failed to write KV key "${ kvKey }"`,
                { cause },
            );
        }

        return { filepath: logicalKey };
    }

    /**
     * Resolves a single file's keys, owning the `{namespace}/{barePrefix}{filepath}`
     * encoding shared by the read and write methods.
     * @param {string|null} namespace - Optional namespace used to prefix the KV key
     * @param {string} barePrefix - Logical prefix (e.g. `base/`)
     * @param {string} filepath - Logical filename relative to the prefix
     * @returns {{logicalKey: string, kvKey: string}} The namespace-free logical key and the namespace-prefixed KV key
     */
    #resolveKey(namespace, barePrefix, filepath) {
        const safeNamespace = this.#resolveNamespace(namespace);
        const logicalKey = `${ barePrefix }${ filepath.replace(/^\//, '') }`;
        const kvKey = safeNamespace ? `${ safeNamespace }/${ logicalKey }` : logicalKey;
        return { logicalKey, kvKey };
    }

    /**
     * Validates and normalizes an optional namespace. Treats nullish and empty
     * values as "no namespace" (the flat, unprefixed namespace).
     * @param {string|null} [namespace] - Optional namespace supplied by the caller
     * @returns {string} The validated namespace, or an empty string when omitted
     * @throws {Error} When a non-empty namespace is not a string or contains ".." segments
     */
    #resolveNamespace(namespace) {
        if (namespace === null || namespace === undefined || namespace === '') {
            return '';
        }

        assertNonEmptyString(namespace, 'TemplateFileStore namespace must be a string when provided');
        // Reject path traversal so a caller cannot escape the namespace.
        assert(
            !namespace.split('/').includes('..'),
            'TemplateFileStore namespace must not contain ".." segments',
        );

        return namespace;
    }

    /**
     * Resolves the KV read cache TTL in seconds for a namespace. Namespaced keys
     * get the configured (long) TTL because a build never rewrites its own
     * templates; un-namespaced keys are capped because they can be overwritten in
     * place.
     * @param {RequestContext} context - Request context carrying the store config
     * @param {string|null} [namespace] - Optional namespace supplied by the caller
     * @returns {number} Cache TTL in seconds
     * @throws {AssertionError} When a configured cacheTtl is not an integer of at least 30
     */
    #resolveCacheTtl(context, namespace) {
        const { config } = context;
        const { cacheTtl } = config?.env?.HYPERVIEW_TEMPLATE_FILE_STORE ?? {};

        let ttl = DEFAULT_CACHE_TTL_SECONDS;

        if (!isUndefined(cacheTtl) && cacheTtl !== null) {
            // A misconfigured TTL is a source-config bug, not user input. Fail
            // loudly here rather than letting Cloudflare reject the read
            // mid-request.
            if (!Number.isInteger(cacheTtl) || cacheTtl < MIN_CACHE_TTL_SECONDS) {
                throw new AssertionError(
                    `TemplateFileStore "cacheTtl" must be an integer of at least ${ MIN_CACHE_TTL_SECONDS } seconds`,
                );
            }
            ttl = cacheTtl;
        }

        // Clamp rather than substitute, so a deployment which configures a TTL
        // shorter than the flat-keyspace cap still gets the shorter value.
        if (!this.#resolveNamespace(namespace)) {
            return Math.min(ttl, MAX_UNNAMESPACED_CACHE_TTL_SECONDS);
        }

        return ttl;
    }

    #getKVStore(context) {
        const { config, env } = context;
        let { bindingName } = config?.env?.HYPERVIEW_TEMPLATE_FILE_STORE ?? {};
        bindingName = bindingName || DEFAULT_BINDING_NAME;
        const kvStore = env[bindingName];
        assert(kvStore, `TemplateFileStore KV binding "${ bindingName }" is not bound on context.env`);
        return kvStore;
    }

    async #loadPrefixedFiles(context, namespace, barePrefix) {
        const kvStore = this.#getKVStore(context);
        const safeNamespace = this.#resolveNamespace(namespace);
        const prefix = safeNamespace ? `${safeNamespace}/${barePrefix}` : barePrefix;
        this.#logger.debug('load prefixed files', { prefix });

        // KV list() accepts no cacheTtl, so this call reaches the central store on
        // every isolate that has not already loaded partials. Only the bulk read
        // below benefits from the cache TTL.
        const { keys } = await kvStore.list({ prefix });
        const kvFilepaths = keys.map((key) => key.name);

        if (kvFilepaths.length === 0) {
            return [];
        }

        const cacheTtl = this.#resolveCacheTtl(context, namespace);
        const resultMap = await kvStore.get(kvFilepaths, { type: 'text', cacheTtl });
        const files = [];

        for (const kvFilepath of kvFilepaths) {
            const source = resultMap.get(kvFilepath) ?? null;
            if (source !== null) {
                // Strip the namespace prefix to return a logical filepath to callers.
                const filepath = safeNamespace ? kvFilepath.slice(safeNamespace.length + 1) : kvFilepath;
                files.push({ filepath, source });
            }
        }

        return files;
    }

    #manifestKey(namespace) {
        return `${ namespace }/${ PARTIALS_MANIFEST_FILENAME }`;
    }

    async #loadPartialsManifest(context, namespace) {
        const manifestKey = this.#manifestKey(namespace);
        const cacheTtl = this.#resolveCacheTtl(context, namespace);
        const kvStore = this.#getKVStore(context);
        this.#logger.debug('getPartials() loading manifest', { key: manifestKey, cacheTtl });

        let manifest;
        try {
            manifest = await kvStore.get(manifestKey, { type: 'json', cacheTtl });
        } catch (cause) {
            throw new OperationalError(
                `TemplateFileStore failed to read partial manifest "${ manifestKey }"`,
                { cause },
            );
        }

        // A namespace is expected to have been staged by putPartials() before it
        // is ever read; a missing manifest means that never happened, which is an
        // invariant failure rather than "no partials published yet".
        assert(
            manifest !== null,
            `TemplateFileStore found no published partial manifest for namespace "${ namespace }"`,
        );

        return this.#parsePartialsManifest(manifest, manifestKey);
    }

    /**
     * Validates manifest structure without normalizing it: keys and values are
     * trusted verbatim from callers of putPartials(), so any deviation here
     * indicates the manifest was corrupted or written outside this contract.
     */
    #parsePartialsManifest(manifest, manifestKey) {
        assert(
            isPlainObject(manifest),
            `TemplateFileStore partial manifest "${ manifestKey }" must be a JSON object`,
        );

        const files = [];

        for (const filepath of Object.keys(manifest)) {
            const source = manifest[filepath];
            assert(
                isValidManifestKey(filepath),
                `TemplateFileStore partial manifest "${ manifestKey }" has an invalid key "${ filepath }"`,
            );
            assert(
                isNonEmptyString(source),
                `TemplateFileStore partial manifest "${ manifestKey }" has an invalid source for "${ filepath }"`,
            );
            files.push({ filepath, source });
        }

        return files;
    }
}

/**
 * A valid manifest key is a canonical, lower-case logical filepath beginning
 * with the `partials/` prefix, with no empty or traversal path segments.
 */
function isValidManifestKey(key) {
    if (!isNonEmptyString(key) || key !== key.toLowerCase() || !key.startsWith(PARTIALS_PREFIX)) {
        return false;
    }

    const remainder = key.slice(PARTIALS_PREFIX.length);
    if (!remainder) {
        return false;
    }

    return remainder.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
