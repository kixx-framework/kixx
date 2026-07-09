import path from 'node:path';
import fsp from 'node:fs/promises';

import {
    AssertionError,
    assert,
    assertFunction,
    assertNonEmptyString,
    isUndefined,
} from '../../../kixx/assertions/mod.js';

const BASE_TEMPLATE_PREFIX = 'base/';
const PAGE_TEMPLATE_PREFIX = 'pages/';
const PARTIALS_PREFIX = 'partials/';

/**
 * Node.js filesystem-backed store for shared Hyperview templates.
 *
 * This is the Node.js port of the Cloudflare KV template store. Where the
 * Cloudflare adapter resolves a KV binding from each request `context`, this
 * adapter resolves its root directory from
 * `context.config.env.HYPERVIEW_TEMPLATE_FILE_STORE.directory` and
 * `context.config.resolveFilepath()` on first use unless an explicit
 * constructor `directory` was supplied. The resolved directory is fixed for the
 * lifetime of the store: a later request that resolves a different directory is
 * a programmer error and throws an `AssertionError`.
 *
 * Base template ids are resolved relative to `base/` and page template ids
 * relative to `pages/`; partials are loaded from `partials/` (recursively) and
 * returned with their full logical filepath for downstream name normalization.
 *
 * Every read and write method accepts an optional `namespace`. When provided,
 * filesystem paths are namespaced as `{root}/{namespace}/{prefix}{filepath}`
 * so that multiple versions of a build can coexist under the same root directory
 * and deployments stay idempotent. When the namespace is omitted, files are
 * stored at the flat `{root}/{prefix}{filepath}` — which supports use cases
 * which do *not* use idempotent deployments. Callers always work with logical
 * filepaths; the namespace prefix is applied and stripped internally, and
 * keeping the read and write namespaces consistent is the caller's
 * responsibility.
 *
 * @implements {import('../../../kixx/hyperview/template-file-store-interface.js').TemplateFileStoreInterface}
 */
export default class TemplateFileStore {

    #logger = null;

    // An explicit constructor `directory`, or null when the directory comes from
    // request config. Fixed for the lifetime of the store.
    #directory = null;

    // The directory resolved from request config, locked on first use. Only used
    // when no explicit constructor `directory` was supplied.
    #resolvedDirectory = null;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create a TemplateFileStore child logger
     * @param {string} [options.directory] - Filesystem directory override that roots the template store
     * @throws {Error} When logger is not provided, or when `directory` is supplied but empty
     */
    constructor(options) {
        const { logger, directory } = options ?? {};
        assert(logger, 'TemplateFileStore requires a logger');
        if (!isUndefined(directory)) {
            assertNonEmptyString(directory, 'TemplateFileStore directory must be a non-empty string when provided');
        }
        this.#logger = logger.createChild('TemplateFileStore');
        this.#directory = directory ?? null;
    }

    /**
     * Retrieves a base template source file from the shared template directory.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Base template filename relative to `base/`
     * @returns {Promise<{filepath: string, source: string}|null>} Resolves to template source with logical filepath, or null when missing
     */
    async getBaseTemplate(context, namespace, filepath) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#getFile(rootDirectory, namespace, BASE_TEMPLATE_PREFIX, filepath);
    }

    /**
     * Writes (creates or overwrites) a base template source file in the shared
     * template directory under the optional namespace.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Base template filename relative to `base/`
     * @param {string} source - Template source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putBaseTemplate(context, namespace, filepath, source) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#putFile(rootDirectory, namespace, BASE_TEMPLATE_PREFIX, filepath, source);
    }

    /**
     * Retrieves a page template source file from the shared template directory.
     * The filepath may be nested several segments deep, delimited by `/`.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Page template filepath relative to `pages/`
     * @returns {Promise<{filepath: string, source: string}|null>} Resolves to template source with logical filepath, or null when missing
     */
    async getPageTemplate(context, namespace, filepath) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#getFile(rootDirectory, namespace, PAGE_TEMPLATE_PREFIX, filepath);
    }

    /**
     * Writes (creates or overwrites) a page template source file in the shared
     * template directory under the optional namespace. The filepath may be nested
     * several segments deep, delimited by `/`.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Page template filepath relative to `pages/`
     * @param {string} source - Template source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putPageTemplate(context, namespace, filepath, source) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#putFile(rootDirectory, namespace, PAGE_TEMPLATE_PREFIX, filepath, source);
    }

    /**
     * Writes (creates or overwrites) a partial template source file in the shared
     * template directory under the optional namespace.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the filesystem path
     * @param {string} filepath - Partial filename relative to `partials/`
     * @param {string} source - Partial source text to store
     * @returns {Promise<{filepath: string}>} Resolves with the logical filepath that was written
     */
    async putPartial(context, namespace, filepath, source) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#putFile(rootDirectory, namespace, PARTIALS_PREFIX, filepath, source);
    }

    /**
     * Retrieves all available partial templates from the shared template
     * directory, walking the `partials/` tree recursively.
     * @param {Object} context - Request or execution context used to resolve Node request config
     * @param {string|null} [namespace] - Optional namespace used to prefix the partials directory
     * @returns {Promise<{filepath: string, source: string}[]>} Resolves to existing partial source files with logical filepaths in directory walk order
     */
    async getPartials(context, namespace) {
        const rootDirectory = this.#resolveDirectory(context);
        return await this.#loadPrefixedFiles(rootDirectory, namespace, PARTIALS_PREFIX);
    }

    async #getFile(rootDirectory, namespace, barePrefix, filepath) {
        const safeFilepath = this.#resolveFilepath(filepath, 'read');
        const { logicalKey, fsPath } = this.#resolveKey(rootDirectory, namespace, barePrefix, safeFilepath);
        this.#logger.debug('getFile() loading path', { path: fsPath });

        let source;
        try {
            source = await fsp.readFile(fsPath, 'utf8');
        } catch (cause) {
            // A missing template is a normal result, not an error.
            if (cause.code === 'ENOENT') {
                return null;
            }
            throw cause;
        }

        return { filepath: logicalKey, source };
    }

    async #putFile(rootDirectory, namespace, barePrefix, filepath, source) {
        const safeFilepath = this.#resolveFilepath(filepath, 'write');
        assertNonEmptyString(source, 'TemplateFileStore write requires source text');

        const { logicalKey, fsPath } = this.#resolveKey(rootDirectory, namespace, barePrefix, safeFilepath);
        this.#logger.debug('putFile() writing path', { path: fsPath });

        // Nested page templates and partials live several directories deep; ensure
        // the parent tree exists before writing the file.
        await fsp.mkdir(path.dirname(fsPath), { recursive: true });
        await fsp.writeFile(fsPath, source, 'utf8');

        return { filepath: logicalKey };
    }

    #resolveFilepath(filepath, operation) {
        assertNonEmptyString(filepath, `TemplateFileStore ${ operation } requires a filepath`);
        const safeFilepath = filepath.replace(/^\//, '');

        // Reject path traversal so a client cannot escape its prefix or the namespace.
        assert(
            !safeFilepath.split(/[\\/]/).includes('..'),
            `TemplateFileStore ${ operation } filepath must not contain ".." segments`,
        );

        return safeFilepath;
    }

    /**
     * Resolves a single file's keys, owning the
     * `{root}/{namespace}/{barePrefix}{filepath}` encoding shared by the
     * read and write methods.
     * @param {string} rootDirectory - Absolute filesystem root directory
     * @param {string|null} namespace - Optional namespace used to prefix the filesystem path
     * @param {string} barePrefix - Logical prefix (e.g. `base/`)
     * @param {string} filepath - Logical filename relative to the prefix
     * @returns {{logicalKey: string, fsPath: string}} The namespace-free logical key and the resolved filesystem path
     */
    #resolveKey(rootDirectory, namespace, barePrefix, filepath) {
        const safeNamespace = this.#resolveNamespace(namespace);
        const logicalKey = `${ barePrefix }${ filepath }`;
        // Split the logical key on '/' so path.join builds a platform-correct path.
        const fsPath = path.join(rootDirectory, safeNamespace, ...logicalKey.split('/'));
        return { logicalKey, fsPath };
    }

    #resolveDirectory(context) {
        // An explicit constructor directory is fixed and never read from config.
        if (this.#directory) {
            return this.#directory;
        }

        const directory = this.#resolveDirectoryFromConfig(context);

        if (this.#resolvedDirectory === null) {
            // First request locks the directory for the lifetime of the store.
            this.#resolvedDirectory = directory;
        } else if (directory !== this.#resolvedDirectory) {
            // The configured directory is expected to be constant; a change means
            // the application is misconfigured, which is a programmer error.
            throw new AssertionError(
                `TemplateFileStore directory must not change after it is set (was "${ this.#resolvedDirectory }", got "${ directory }")`,
            );
        }

        return this.#resolvedDirectory;
    }

    #resolveDirectoryFromConfig(context) {
        const config = context?.config;
        const storeConfig = config?.env?.HYPERVIEW_TEMPLATE_FILE_STORE;
        assertNonEmptyString(
            storeConfig?.directory,
            'TemplateFileStore requires context.config.env.HYPERVIEW_TEMPLATE_FILE_STORE.directory',
        );
        assertFunction(
            config?.resolveFilepath,
            'TemplateFileStore requires context.config.resolveFilepath',
        );

        const rootDirectory = config.resolveFilepath(storeConfig.directory);
        assertNonEmptyString(
            rootDirectory,
            'TemplateFileStore context.config.resolveFilepath() must return a non-empty string',
        );

        return rootDirectory;
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
            !namespace.split(/[\\/]/).includes('..'),
            'TemplateFileStore namespace must not contain ".." segments',
        );

        return namespace;
    }

    async #loadPrefixedFiles(rootDirectory, namespace, barePrefix) {
        const safeNamespace = this.#resolveNamespace(namespace);
        // The namespace root is what logical filepaths are made relative to, so a
        // returned filepath keeps the bare prefix (e.g. `partials/nav.html`) but
        // never the namespace.
        const namespaceRoot = path.join(rootDirectory, safeNamespace);
        const prefixDir = path.join(namespaceRoot, barePrefix);
        this.#logger.debug('load prefixed files', { path: prefixDir });

        const absolutePaths = await this.#walkFiles(prefixDir);
        const files = [];

        for (const absolutePath of absolutePaths) {
            const source = await fsp.readFile(absolutePath, 'utf8');
            // Normalize OS separators back to the logical '/' delimiter.
            const filepath = path.relative(namespaceRoot, absolutePath).split(path.sep).join('/');
            files.push({ filepath, source });
        }

        return files;
    }

    /**
     * Recursively collects absolute file paths under a directory. A missing
     * directory yields an empty list, mirroring "no files present".
     * @param {string} dir - Directory to walk
     * @returns {Promise<string[]>} Absolute paths of every regular file found
     */
    async #walkFiles(dir) {
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                return [];
            }
            throw cause;
        }

        const files = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const nested = await this.#walkFiles(fullPath);
                files.push(...nested);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }

        return files;
    }
}
