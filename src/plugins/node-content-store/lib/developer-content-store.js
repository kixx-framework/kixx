import {
    AssertionError,
    assert,
    assertArray,
    assertNonEmptyString,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';

import DeveloperSourceScanner from './developer-source-scanner.js';
import { buildDeveloperIndex } from './developer-index.js';
import { getDeveloperBlob } from './developer-blobs.js';

const GET_FILE_TYPES = [ 'text', 'arrayBuffer', 'stream' ];
const BULK_FILE_LIMIT = 100;

/**
 * Read-only content store backed by mutable developer source directories.
 *
 * Each `getIndex()` scan replaces the retained manifest. Reads address that
 * manifest by pathname and may therefore observe a newer tree if concurrent
 * requests interleave scans. This deliberately weakens snapshot pinning for a
 * single-developer local server; production adapters remain content-addressed.
 *
 * @implements {import('../../../kixx/content-addressable-store/content-store-interface.js').ContentStoreInterface}
 */
export default class DeveloperContentStore {

    #logger;
    #scanner;
    #fileSystem;
    #manifest = new Map();
    #closed = false;

    /**
     * @param {Object} options - Store configuration
     * @param {import('../../../kixx/logger/logger.js').default} options.logger - Root logger used to create an adapter child logger
     * @param {string} options.pagesDirectory - Root of page sources
     * @param {string} options.templatesDirectory - Root of template sources
     * @param {string} options.staticAssetsDirectory - Root of static assets
     * @param {string} options.emailsDirectory - Root of email sources
     * @param {Object} [options.fileSystem] - Promise-based filesystem API used by tests
     */
    constructor(options) {
        const { logger, fileSystem, ...sourceDirectories } = options ?? {};

        assert(logger, 'DeveloperContentStore requires a logger');
        this.#logger = logger.createChild('DeveloperContentStore');
        this.#fileSystem = fileSystem;
        this.#scanner = new DeveloperSourceScanner({ ...sourceDirectories, fileSystem });
    }

    /**
     * Rescans developer sources and returns their current encoded index.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {string|null} _buildId - Ignored because disk is the only developer closure
     * @returns {Promise<{rootHash: null, entries: Object}>} Scanned index table; rootHash is always null because there is no persisted build pointer
     */
    async getBuild(_context, _buildId) {
        this.#assertOpen();
        const manifest = await this.#scanner.scan();
        const entries = await buildDeveloperIndex(manifest);
        this.#manifest = manifest;
        this.#logger.debug('getBuild() scanned developer sources', { fileCount: manifest.size });
        return { rootHash: null, entries };
    }

    /**
     * Reads one source-backed blob by pathname.
     * @param {Object} _context - Request context accepted for interface compatibility
     * @param {'text'|'arrayBuffer'|'stream'} type - Representation to return
     * @param {string} pathname - Storage pathname used as the developer address
     * @param {string} _hash - Ignored source-identity change token
     * @returns {Promise<string|ArrayBuffer|ReadableStream|null>} Blob value, or null when absent
     */
    async getFile(_context, type, pathname, _hash) {
        this.#assertOpen();
        assertValidType(type, 'getFile', GET_FILE_TYPES);
        return await getDeveloperBlob(this.#manifest, pathname, type, this.#fileSystem);
    }

    /**
     * Reads text blobs in the exact order requested.
     * @param {Object} context - Request context accepted for interface compatibility
     * @param {'text'} type - Required text representation
     * @param {Array<{pathname: string, hash: string}>} files - Indexed blob descriptors
     * @returns {Promise<Array<string|null>>} Positional text results
     */
    async getFiles(context, type, files) {
        this.#assertOpen();
        assertValidType(type, 'getFiles', [ 'text' ]);
        assertArray(files, 'DeveloperContentStore#getFiles: files');
        assert(files.length <= BULK_FILE_LIMIT, `DeveloperContentStore#getFiles() accepts at most ${ BULK_FILE_LIMIT } files; received ${ files.length }`);

        for (const [ index, file ] of files.entries()) {
            assert(isPlainObject(file), `DeveloperContentStore#getFiles: files[${ index }] must be a plain object`);
            assertNonEmptyString(file.pathname, `DeveloperContentStore#getFiles: files[${ index }].pathname`);
        }
        return await Promise.all(files.map(({ pathname, hash }) => {
            return this.getFile(context, type, pathname, hash);
        }));
    }

    async putFile() {
        throw new AssertionError('DeveloperContentStore#putFile() cannot write in developer mode');
    }

    async saveIndex() {
        throw new AssertionError('DeveloperContentStore#saveIndex() cannot write in developer mode');
    }

    async assignBuild() {
        throw new AssertionError('DeveloperContentStore#assignBuild() cannot write in developer mode');
    }

    /**
     * Permanently closes this adapter.
     * @returns {void}
     */
    close() {
        this.#closed = true;
        this.#manifest = new Map();
    }

    #assertOpen() {
        if (this.#closed) {
            throw new AssertionError('DeveloperContentStore has been closed');
        }
    }
}

function assertValidType(type, method, acceptedTypes) {
    if (!acceptedTypes.includes(type)) {
        throw new AssertionError(`DeveloperContentStore#${ method }() does not support type "${ type }"`);
    }
}
