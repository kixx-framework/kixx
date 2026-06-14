import { assert, assertNonEmptyString } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

const BASE_TEMPLATE_PREFIX = 'base/';
const PAGE_TEMPLATE_PREFIX = 'pages/';
const PARTIALS_PREFIX = 'partials/';

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
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
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
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
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
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
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
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Page template filepath relative to `pages/`
     * @param {string} source - Template source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putPageTemplate(context, namespace, filepath, source) {
        return await this.#putFile(context, namespace, PAGE_TEMPLATE_PREFIX, filepath, source);
    }

    /**
     * Writes (creates or updates) a partial template source file in the shared
     * template KV store under the optional namespace.
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Partial filename relative to `partials/`
     * @param {string} source - Partial source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putPartial(context, namespace, filepath, source) {
        return await this.#putFile(context, namespace, PARTIALS_PREFIX, filepath, source);
    }

    /**
     * Retrieves all available partial templates from the shared template KV store.
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV listing
     * @returns {Promise<{filepath: string, source: string}[]>} Resolves to existing partial source files with logical filepaths in KV listing order
     */
    async getPartials(context, namespace) {
        return await this.#loadPrefixedFiles(context, namespace, PARTIALS_PREFIX);
    }

    async #getFile(context, namespace, barePrefix, filepath) {
        const { logicalKey, kvKey } = this.#resolveKey(namespace, barePrefix, filepath);
        this.#logger.debug('getFile() loading key', { key: kvKey });
        const kvStore = context.env.TEMPLATE_FILE_STORE;
        const source = await kvStore.get(kvKey, { type: 'text' }) ?? null;

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
        const kvStore = context.env.TEMPLATE_FILE_STORE;
        await kvStore.put(kvKey, source);

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

    async #loadPrefixedFiles(context, namespace, barePrefix) {
        const kvStore = context.env.TEMPLATE_FILE_STORE;
        const safeNamespace = this.#resolveNamespace(namespace);
        const prefix = safeNamespace ? `${safeNamespace}/${barePrefix}` : barePrefix;
        this.#logger.debug('load prefixed files', { prefix });

        const { keys } = await kvStore.list({ prefix });
        const kvFilepaths = keys.map((key) => key.name);

        if (kvFilepaths.length === 0) {
            return [];
        }

        const resultMap = await kvStore.get(kvFilepaths, { type: 'text' });
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
}
