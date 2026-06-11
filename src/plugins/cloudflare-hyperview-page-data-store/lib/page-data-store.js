import { assert } from '../../../kixx/assertions/mod.js';

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
        const buildId = context.runtime.build?.id || '';

        const normalizedPaths = filepaths.map((fp) => fp.replace(/^\//, ''));
        const kvKeys = normalizedPaths.map((fp) => buildId ? `${buildId}/${fp}` : fp);

        this.#logger.debug('getJSONFiles() loading keys', { keys: kvKeys });

        const resultMap = await kvStore.get(kvKeys, { type: 'json' });

        return normalizedPaths.map((filepath, i) => {
            const json = resultMap.get(kvKeys[i]) ?? null;
            if (json === null) {
                return null;
            }
            return { filepath, json };
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
        const buildId = context.runtime.build?.id || '';

        const normalizedPaths = filepaths.map((fp) => fp.replace(/^\//, ''));
        const kvKeys = normalizedPaths.map((fp) => buildId ? `${buildId}/${fp}` : fp);

        this.#logger.debug('getTextFiles() loading keys', { keys: kvKeys });

        const resultMap = await kvStore.get(kvKeys, { type: 'text' });

        return normalizedPaths.map((filepath, i) => {
            const source = resultMap.get(kvKeys[i]);
            if (source) {
                return { filepath, source };
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
        const kvStore = context.env.PAGE_DATA_STORE;
        const buildId = context.runtime.build?.id || '';
        const normalizedPath = filepath.replace(/^\//, '');
        const kvKey = buildId ? `${buildId}/${normalizedPath}` : normalizedPath;
        this.#logger.debug('getTextFile() loading key', { key: kvKey });
        const text = await kvStore.get(kvKey, { type: 'text' });
        return text ?? null;
    }
}
