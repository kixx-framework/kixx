import path from 'node:path';
import fsp from 'node:fs/promises';

import { assert, assertNonEmptyString, isObjectNotNull } from '../../../kixx/assertions/mod.js';

/**
 * Node.js filesystem-backed store for Hyperview page assets.
 *
 * This is the Node.js port of the Cloudflare KV page data store. Where the
 * Cloudflare adapter resolves a KV binding from each request `context`, this
 * adapter owns a long-lived root `directory` supplied at construction and maps
 * logical addresses onto real filesystem paths, ignoring the `context` argument
 * entirely.
 *
 * Page data files are *not* grouped under fixed logical prefixes: a filepath is
 * the page-relative path of the asset (e.g. `blog/2026/post/page.json`).
 *
 * Every read and write method accepts an optional `namespace`. When provided,
 * filesystem paths are namespaced as `{directory}/{namespace}/{filepath}` so that
 * multiple versions of a build can coexist under the same root directory and
 * deployments stay idempotent. When the namespace is omitted, files are stored at
 * the flat `{directory}/{filepath}` — which supports use cases which do *not* use
 * idempotent deployments. Callers always work with logical filepaths; the
 * namespace prefix is applied and stripped internally, and keeping the read and
 * write namespaces consistent is the caller's responsibility.
 *
 * @implements {import('../../../kixx/hyperview/page-data-store-interface.js').PageDataStoreInterface}
 */
export default class PageDataStore {

    #logger = null;
    #directory = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a PageDataStore child logger
     * @param {string} options.directory - Filesystem directory that roots the page data store
     * @throws {Error} When logger or directory is not provided
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assert(logger, 'PageDataStore requires a logger');
        assertNonEmptyString(directory, 'PageDataStore requires a directory');
        this.#logger = logger.createChild('PageDataStore');
        this.#directory = directory;
    }

    /**
     * Reads JSON files by filepath, returning a positional array aligned with the
     * input. Missing files are null at the corresponding index; present files are
     * parsed and returned under the `json` property.
     * @param {Object} _context - Ignored; present for PageDataStoreInterface compatibility
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem paths
     * @param {string[]} filepaths - Logical file paths (without namespace prefix)
     * @returns {Promise<({filepath: string, json: Object}|null)[]>}
     */
    async getJSONFiles(_context, namespace, filepaths) {
        this.#logger.debug('getJSONFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const resolved = filepaths.map((fp) => this.#resolveKey(namespace, fp, 'read'));

        const files = [];
        for (const { logicalKey, fsPath } of resolved) {
            const source = await this.#readFileOrNull(fsPath);
            if (source === null) {
                files.push(null);
            } else {
                files.push({ filepath: logicalKey, json: JSON.parse(source) });
            }
        }

        return files;
    }

    /**
     * Reads text files by filepath, returning a positional array aligned with the
     * input. Missing files are null; present files return `{ filepath, source }`.
     * @param {Object} _context - Ignored; present for PageDataStoreInterface compatibility
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem paths
     * @param {string[]} filepaths - Logical file paths (without namespace prefix)
     * @returns {Promise<({filepath: string, source: string}|null)[]>}
     */
    async getTextFiles(_context, namespace, filepaths) {
        this.#logger.debug('getTextFiles() loading filepaths', { filepaths });
        if (filepaths.length === 0) {
            return [];
        }

        const resolved = filepaths.map((fp) => this.#resolveKey(namespace, fp, 'read'));

        const files = [];
        for (const { logicalKey, fsPath } of resolved) {
            const source = await this.#readFileOrNull(fsPath);
            if (source === null) {
                files.push(null);
            } else {
                files.push({ filepath: logicalKey, source });
            }
        }

        return files;
    }

    /**
     * Reads a single text file by filepath.
     * @param {Object} _context - Ignored; present for PageDataStoreInterface compatibility
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @returns {Promise<string|null>} File source text, or null if not found
     */
    async getTextFile(_context, namespace, filepath) {
        this.#logger.debug('getTextFile() loading filepath', { filepath });
        const { fsPath } = this.#resolveKey(namespace, filepath, 'read');
        return await this.#readFileOrNull(fsPath);
    }

    /**
     * Writes (creates or overwrites) a JSON file in the page data directory under
     * the optional namespace. The value is serialized to JSON text for storage.
     * @param {Object} _context - Ignored; present for PageDataStoreInterface compatibility
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @param {Object} json - JSON-serializable value to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putJSONFile(_context, namespace, filepath, json) {
        assert(isObjectNotNull(json), 'PageDataStore write requires a non-null JSON object');
        return await this.#putFile(namespace, filepath, JSON.stringify(json));
    }

    /**
     * Writes (creates or overwrites) a text file in the page data directory under
     * the optional namespace.
     * @param {Object} _context - Ignored; present for PageDataStoreInterface compatibility
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @param {string} source - File source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putTextFile(_context, namespace, filepath, source) {
        assertNonEmptyString(source, 'PageDataStore write requires source text');
        return await this.#putFile(namespace, filepath, source);
    }

    async #putFile(namespace, filepath, value) {
        const { logicalKey, fsPath } = this.#resolveKey(namespace, filepath, 'write');
        this.#logger.debug('putFile() writing path', { path: fsPath });

        // Page assets are nested page-relative paths; ensure the parent tree
        // exists before writing the file.
        await fsp.mkdir(path.dirname(fsPath), { recursive: true });
        await fsp.writeFile(fsPath, value, 'utf8');

        return { filepath: logicalKey };
    }

    /**
     * Reads a file as UTF-8 text, translating a missing file into the contract's
     * `null` result rather than an error.
     * @param {string} fsPath - Absolute filesystem path to read
     * @returns {Promise<string|null>} The file text, or null when the file is absent
     */
    async #readFileOrNull(fsPath) {
        this.#logger.debug('readFile() loading path', { path: fsPath });
        try {
            return await fsp.readFile(fsPath, 'utf8');
        } catch (cause) {
            // A missing file is a normal result, not an error.
            if (cause.code === 'ENOENT') {
                return null;
            }
            throw cause;
        }
    }

    /**
     * Resolves a single file's keys, owning the `{directory}/{namespace}/{filepath}`
     * encoding shared by the read and write methods.
     * @param {string|null} namespace - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Logical file path (without namespace prefix)
     * @param {string} operation - `read` or `write`, used to scope validation messages
     * @returns {{logicalKey: string, fsPath: string}} The namespace-free logical key and the resolved filesystem path
     */
    #resolveKey(namespace, filepath, operation) {
        const safeNamespace = this.#resolveNamespace(namespace);
        const logicalKey = this.#resolveFilepath(filepath, operation);
        // Split the logical key on '/' so path.join builds a platform-correct path.
        const fsPath = path.join(this.#directory, safeNamespace, ...logicalKey.split('/'));
        return { logicalKey, fsPath };
    }

    /**
     * Validates a filepath and strips a leading slash so `'/page.json'` and
     * `'page.json'` address the same file.
     * @param {string} filepath - Logical file path supplied by the caller
     * @param {string} operation - `read` or `write`, used to scope validation messages
     * @returns {string} The normalized, namespace-free logical filepath
     * @throws {Error} When the filepath is not a non-empty string or contains ".." segments
     */
    #resolveFilepath(filepath, operation) {
        assertNonEmptyString(filepath, `PageDataStore ${ operation } requires a filepath`);
        const safeFilepath = filepath.replace(/^\/+/, '');
        assertNonEmptyString(safeFilepath, `PageDataStore ${ operation } requires a filepath`);

        // Reject path traversal so a client cannot escape the directory or namespace.
        assert(
            !safeFilepath.split(/[\\/]/).includes('..'),
            `PageDataStore ${ operation } filepath must not contain ".." segments`,
        );

        return safeFilepath;
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
            !namespace.split(/[\\/]/).includes('..'),
            'PageDataStore namespace must not contain ".." segments',
        );

        return namespace;
    }
}
