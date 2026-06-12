import { assert, assertNonEmptyString, isObjectNotNull } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

/**
 * Cloudflare KV-backed store for Hyperview page assets.
 * Reads page.json and include files from the PAGE_DATA_STORE KV binding.
 *
 * Every read and write method accepts an optional `namespace`. When provided, KV
 * keys are namespaced as `{namespace}/{filepath}` so that multiple versions of a
 * build can coexist in the same KV namespace and deployments stay idempotent.
 * When the namespace is omitted, keys are stored at the flat, unprefixed
 * namespace — which supports use cases which do *not* use idempotent deployments.
 * Callers always work with logical filepaths; the namespace prefix is applied
 * and stripped internally, and keeping the read and write namespaces consistent
 * is the caller's responsibility.
 *
 * @implements {import('../../../kixx/hyperview/page-data-store-interface.js').PageDataStoreInterface}
 */
export default class PageDataStore {

    #logger = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a PageDataStore child logger
     * @throws {Error} When logger is not provided
     */
    constructor(options) {
        const { logger } = options ?? {};
        assert(logger, 'PageDataStore requires a logger');
        this.#logger = logger.createChild('PageDataStore');
    }

    /**
     * Fetches JSON files by filepath, returning a positional array aligned with
     * the input. Missing keys are null at the corresponding index.
     *
     * Note: Cloudflare KV bulk get supports at most 100 keys per call.
     * @param {RequestContext} context
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV keys
     * @param {string[]} filepaths - Logical file paths (without namespace prefix)
     * @returns {Promise<({filepath: string, json: Object}|null)[]>}
     */
    async getJSONFiles(context, namespace, filepaths) {
        this.#logger.debug('getJSONFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const kvStore = context.env.PAGE_DATA_STORE;
        const resolved = filepaths.map((fp) => this.#resolveKey(namespace, fp));
        const kvKeys = resolved.map((r) => r.kvKey);

        this.#logger.debug('getJSONFiles() loading keys', { keys: kvKeys });

        const resultMap = await kvStore.get(kvKeys, { type: 'json' });

        return resolved.map(({ logicalKey, kvKey }) => {
            const json = resultMap.get(kvKey) ?? null;
            if (json === null) {
                return null;
            }
            return { filepath: logicalKey, json };
        });
    }

    /**
     * Fetches text files by filepath, returning a positional array aligned with
     * the input. Missing keys are null; present keys return `{ filepath, source }`.
     *
     * Note: Cloudflare KV bulk get supports at most 100 keys per call.
     * @param {RequestContext} context
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV keys
     * @param {string[]} filepaths - Logical file paths (without namespace prefix)
     * @returns {Promise<({filepath: string, source: string}|null)[]>}
     */
    async getTextFiles(context, namespace, filepaths) {
        this.#logger.debug('getTextFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const kvStore = context.env.PAGE_DATA_STORE;
        const resolved = filepaths.map((fp) => this.#resolveKey(namespace, fp));
        const kvKeys = resolved.map((r) => r.kvKey);

        this.#logger.debug('getTextFiles() loading keys', { keys: kvKeys });

        const resultMap = await kvStore.get(kvKeys, { type: 'text' });

        return resolved.map(({ logicalKey, kvKey }) => {
            const source = resultMap.get(kvKey);
            if (source) {
                return { filepath: logicalKey, source };
            }
            return null;
        });
    }

    /**
     * Fetches a single text file by filepath.
     * @param {RequestContext} context
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @returns {Promise<string|null>} File source text, or null if not found
     */
    async getTextFile(context, namespace, filepath) {
        this.#logger.debug('getTextFile() loading filepath', { filepath });
        const { kvKey } = this.#resolveKey(namespace, filepath);
        this.#logger.debug('getTextFile() loading key', { key: kvKey });
        const kvStore = context.env.PAGE_DATA_STORE;
        const text = await kvStore.get(kvKey, { type: 'text' });
        return text ?? null;
    }

    /**
     * Writes (creates or updates) a JSON file in the page data KV store under
     * the optional namespace. The value is serialized to JSON text for storage.
     * @param {RequestContext} context
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @param {Object} json - JSON-serializable value to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putJSONFile(context, namespace, filepath, json) {
        assert(isObjectNotNull(json), 'PageDataStore write requires a non-null JSON object');
        return await this.#putFile(context, namespace, filepath, JSON.stringify(json));
    }

    /**
     * Writes (creates or updates) a text file in the page data KV store under
     * the optional namespace.
     * @param {RequestContext} context
     * @param {string|null} [namespace] - Optional namespace used to prefix the KV key
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @param {string} source - File source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putTextFile(context, namespace, filepath, source) {
        assertNonEmptyString(source, 'PageDataStore write requires source text');
        return await this.#putFile(context, namespace, filepath, source);
    }

    async #putFile(context, namespace, filepath, value) {
        assertNonEmptyString(filepath, 'PageDataStore write requires a filepath');
        // Reject path traversal so a client cannot escape the build namespace.
        assert(
            !filepath.split('/').includes('..'),
            'PageDataStore write filepath must not contain ".." segments',
        );

        const { logicalKey, kvKey } = this.#resolveKey(namespace, filepath);
        this.#logger.debug('putFile() writing key', { key: kvKey });
        const kvStore = context.env.PAGE_DATA_STORE;
        await kvStore.put(kvKey, value);

        return { filepath: logicalKey };
    }

    /**
     * Resolves a single file's keys, owning the `{namespace}/{filepath}` encoding
     * shared by the read and write methods.
     * @param {string|null} namespace - Optional namespace used to prefix the KV key
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @returns {{logicalKey: string, kvKey: string}} The namespace-free logical key and the namespace-prefixed KV key
     */
    #resolveKey(namespace, filepath) {
        const safeNamespace = this.#resolveNamespace(namespace);
        const logicalKey = filepath.replace(/^\//, '');
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

        assertNonEmptyString(namespace, 'PageDataStore namespace must be a string when provided');
        // Reject path traversal so a caller cannot escape the namespace.
        assert(
            !namespace.split('/').includes('..'),
            'PageDataStore namespace must not contain ".." segments',
        );

        return namespace;
    }
}
