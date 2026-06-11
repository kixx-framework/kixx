import { assert } from '../../../kixx/assertions/mod.js';

/**
 * @typedef {import('../../../kixx/context/request-context.js').default} RequestContext
 */

const BASE_TEMPLATE_PREFIX = 'base-templates/';
const PARTIALS_PREFIX = 'partials/';
const BUNDLED_FILES_PREFIX = 'bundled-files/';

/**
 * Cloudflare KV-backed store for shared Hyperview templates.
 *
 * Template ids are resolved relative to `base-templates/`; partials are loaded
 * from `partials/` and returned with their full logical filepath for downstream
 * name normalization.
 *
 * All KV keys are prefixed with the build ID (`{buildId}/{key}`) to ensure
 * deployments are idempotent and multiple build versions can coexist in the
 * same KV namespace. Callers always work with logical filepaths; the build ID
 * prefix is applied and stripped internally.
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
     * @param {string} filepath - Base template filename relative to `base-templates/`
     * @returns {Promise<{filepath: string, source: string}|null>} Resolves to template source with logical filepath, or null when missing
     */
    async getTemplate(context, filepath) {
        this.#logger.debug('getTemplate() loading filepath', { filepath });
        const kvStore = context.env.TEMPLATE_FILE_STORE;
        const buildId = context.runtime.build?.id || '';
        const logicalKey = `${ BASE_TEMPLATE_PREFIX }${ filepath.replace(/^\//, '') }`;
        const kvKey = buildId ? `${buildId}/${logicalKey}` : logicalKey;
        this.#logger.debug('getTemplate() loading key', { key: kvKey });
        const source = await kvStore.get(kvKey, { type: 'text' }) ?? null;

        if (source !== null) {
            return { filepath: logicalKey, source };
        }

        return null;
    }

    /**
     * Retrieves all available partial templates from the shared template KV store.
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
     * @returns {Promise<{filepath: string, source: string}[]>} Resolves to existing partial source files with logical filepaths in KV listing order
     */
    async getPartials(context) {
        return await this.#loadPrefixedFiles(context, PARTIALS_PREFIX);
    }

    /**
     * Retrieves all available bundled files from the shared template KV store.
     * @param {RequestContext} context - Request context with the TEMPLATE_FILE_STORE binding
     * @returns {Promise<{filepath: string, source: string}[]>} Resolves to existing source files with logical filepaths in KV listing order
     */
    async getBundledFiles(context) {
        return await this.#loadPrefixedFiles(context, BUNDLED_FILES_PREFIX);
    }

    async #loadPrefixedFiles(context, barePrefix) {
        const kvStore = context.env.TEMPLATE_FILE_STORE;
        const buildId = context.runtime.build?.id || '';
        const prefix = buildId ? `${buildId}/${barePrefix}` : barePrefix;
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
                // Strip the build ID prefix to return a logical filepath to callers.
                const filepath = buildId ? kvFilepath.slice(buildId.length + 1) : kvFilepath;
                files.push({ filepath, source });
            }
        }

        return files;
    }
}
