import { assert, assertNonEmptyString, isObjectNotNull } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

/**
 * Cloudflare KV-backed store for Hyperview page assets.
 * Reads page.json and include files from the PAGE_DATA_STORE KV binding.
 *
 * All KV keys are prefixed with the build ID (`{buildId}/{filepath}`) to
 * ensure deployments are idempotent and multiple build versions can coexist
 * in the same KV namespace. Callers always work with logical filepaths; the
 * build ID prefix is applied and stripped internally.
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
     * @param {string[]} filepaths - Logical file paths (without build ID prefix)
     * @returns {Promise<({filepath: string, json: Object}|null)[]>}
     */
    async getJSONFiles(context, filepaths) {
        this.#logger.debug('getJSONFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const kvStore = context.env.PAGE_DATA_STORE;
        const resolved = filepaths.map((fp) => this.#resolveKey(context, fp));
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
     * @param {string[]} filepaths - Logical file paths (without build ID prefix)
     * @returns {Promise<({filepath: string, source: string}|null)[]>}
     */
    async getTextFiles(context, filepaths) {
        this.#logger.debug('getTextFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const kvStore = context.env.PAGE_DATA_STORE;
        const resolved = filepaths.map((fp) => this.#resolveKey(context, fp));
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
     * @param {string} filepath - Logical file path (without build ID prefix)
     * @returns {Promise<string|null>} File source text, or null if not found
     */
    async getTextFile(context, filepath) {
        this.#logger.debug('getTextFile() loading filepath', { filepath });
        const { kvKey } = this.#resolveKey(context, filepath);
        this.#logger.debug('getTextFile() loading key', { key: kvKey });
        const kvStore = context.env.PAGE_DATA_STORE;
        const text = await kvStore.get(kvKey, { type: 'text' });
        return text ?? null;
    }

    /**
     * Writes (creates or updates) a JSON file in the page data KV store under
     * the current build ID. The value is serialized to JSON text for storage.
     * @param {RequestContext} context
     * @param {string} filepath - Logical file path (without build ID prefix)
     * @param {Object} json - JSON-serializable value to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putJSONFile(context, filepath, json) {
        assert(isObjectNotNull(json), 'PageDataStore write requires a non-null JSON object');
        return await this.#putFile(context, filepath, JSON.stringify(json));
    }

    /**
     * Writes (creates or updates) a text file in the page data KV store under
     * the current build ID.
     * @param {RequestContext} context
     * @param {string} filepath - Logical file path (without build ID prefix)
     * @param {string} source - File source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putTextFile(context, filepath, source) {
        assertNonEmptyString(source, 'PageDataStore write requires source text');
        return await this.#putFile(context, filepath, source);
    }

    async #putFile(context, filepath, value) {
        assertNonEmptyString(filepath, 'PageDataStore write requires a filepath');
        // Reject path traversal so a client cannot escape the build namespace.
        assert(
            !filepath.split('/').includes('..'),
            'PageDataStore write filepath must not contain ".." segments',
        );

        const { logicalKey, kvKey } = this.#resolveKey(context, filepath);
        this.#logger.debug('putFile() writing key', { key: kvKey });
        const kvStore = context.env.PAGE_DATA_STORE;
        await kvStore.put(kvKey, value);

        return { filepath: logicalKey };
    }

    /**
     * Resolves a single file's keys, owning the `{buildId}/{filepath}` encoding
     * shared by the read and write methods.
     * @param {RequestContext} context
     * @param {string} filepath - Logical file path (without build ID prefix)
     * @returns {{logicalKey: string, kvKey: string}} The build-id-free logical key and the build-id-prefixed KV key
     */
    #resolveKey(context, filepath) {
        const buildId = context.runtime.build?.id || '';
        const logicalKey = filepath.replace(/^\//, '');
        const kvKey = buildId ? `${ buildId }/${ logicalKey }` : logicalKey;
        return { logicalKey, kvKey };
    }
}
