import path from 'node:path';
import crypto from 'node:crypto';
import { assert, assertNonEmptyString } from '../../assertions.js';
import { getContentTypeForFileExtension } from '../../utils/http-utils.js';


/**
 * Represents a static file with metadata and streaming access capabilities.
 *
 * Provides read-only access to file properties (size, modification date, content type)
 * and methods for streaming file content and computing hashes for cache validation.
 * Files are immutable once created - properties reflect the state at construction time.
 * @public
 */
export class File {

    /**
     * File statistics object containing size, timestamps, and type information
     * @type {Object|null}
     */
    #stats = null;

    /**
     * File system abstraction for reading files and creating streams.
     * @type {Object|null}
     */
    #fileSystem = null;

    /**
     * Creates a new File instance with the specified filepath and stats.
     * @param {Object} options - File configuration
     * @param {string} options.filepath - Absolute path to the file
     * @param {import('../../node/filesystem/mod.js').FileStats} options.stats - File stats with size, timestamps, and type information
     * @param {Object} options.fileSystem - File system abstraction for I/O operations
     */
    constructor(options) {
        this.#stats = options.stats;
        this.#fileSystem = options.fileSystem;

        /**
         * Absolute path to the file on the filesystem
         * @name filepath
         * @readonly
         * @type {string|null}
         */
        Object.defineProperty(this, 'filepath', {
            enumerable: true,
            value: options.filepath,
        });
    }

    /**
     * File size in bytes from the stats object.
     * @public
     * @type {number}
     */
    get sizeBytes() {
        return this.#stats.size;
    }

    /**
     * File last modification date from the stats object.
     * @public
     * @type {Date}
     */
    get modifiedDate() {
        return this.#stats.mtime;
    }

    /**
     * MIME content type derived from the file extension.
     * @public
     * @type {string}
     */
    get contentType() {
        return getContentTypeForFileExtension(path.extname(this.filepath));
    }

    /**
     * Computes MD5 hash of the file contents for cache validation and ETags.
     *
     * Streams the file to compute the hash without loading the entire file into memory,
     * making it suitable for large static assets. MD5 is used for speed and sufficiency
     * in detecting file changes, not for cryptographic security.
     * @public
     * @returns {Promise<string>} Hexadecimal string representation of the MD5 hash
     * @throws {Error} When the file cannot be read or the stream fails
     */
    async computeHash() {
        const fileInputStream = this.createReadStream();

        // MD5 is used here for generating cache keys/ETags, not for cryptographic
        // security. MD5 is fast and sufficient for detecting file changes.
        const hash = crypto.createHash('md5').setEncoding('hex');

        fileInputStream.pipe(hash);

        return new Promise((resolve, reject) => {
            let result = '';

            hash.on('data', (chunk) => {
                result += chunk;
            });

            hash.on('end', () => {
                resolve(result);
            });

            hash.on('error', (error) => {
                reject(error);
            });

            fileInputStream.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Creates a readable stream for streaming the file contents.
     * @public
     * @returns {ReadStream} Node.js readable stream for the file
     */
    createReadStream() {
        return this.#fileSystem.createReadStream(this.filepath);
    }
}

/**
 * Manages retrieval of static files from a public directory for serving via HTTP.
 *
 * Provides safe access to static files (CSS, JavaScript, images, etc.) by verifying
 * that requested files exist and are regular files (not directories). Returns File
 * instances with metadata and streaming capabilities for efficient content delivery.
 *
 * Security: This class validates that all resolved file paths remain within the
 * public directory to prevent path traversal attacks. Requests attempting to access
 * parent directories will return null.
 *
 * @see {import('../../ports/hyperview-static-file-server-store.js').HyperviewStaticFileServerStore} HyperviewStaticFileServerStore port
 * @public
 */
export default class StaticFileServerStore {

    /**
     * Absolute path to the public directory containing static assets
     * @type {string|null}
     */
    #publicDirectory = null;

    /**
     * File system abstraction for reading files and accessing file metadata
     * @type {Object|null}
     */
    #fileSystem = null;

    /**
     * Creates a new StaticFileServerStore instance for the specified public directory.
     * @param {Object} options - Configuration options
     * @param {string} options.publicDirectory - Absolute path to the public static files directory
     * @param {Object} options.fileSystem - File system abstraction for I/O operations
     */
    constructor(options) {
        options = options || {};

        assertNonEmptyString(options.publicDirectory);
        assert(options.fileSystem, 'StaticFileServerStore fileSystem must be provided');

        this.#publicDirectory = options.publicDirectory;
        this.#fileSystem = options.fileSystem;
    }

    /**
     * Retrieves a File instance for the specified pathname within the public directory.
     *
     * Returns null if the file doesn't exist or if the path points to a directory.
     * Only serves regular files to prevent directory listing attacks.
     *
     * This method validates that the resolved path remains within the public directory
     * to prevent path traversal attacks. Requests attempting to access parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @param {string} pathname - Relative path to the file (e.g., '/css/style.css', 'images/logo.png')
     * @returns {Promise<File|null>} File instance with metadata and streaming access, or null if not found or is a directory
     */
    async getFile(pathname) {
        const filepath = this.#pathnameToFilepath(pathname);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        const stats = await this.#fileSystem.getFileStats(filepath);

        // Return null if file doesn't exist or if the path points to a directory.
        // Only serve regular files, never directories (prevents directory listings).
        if (!stats || !stats.isFile) {
            return null;
        }

        return new File({
            fileSystem: this.#fileSystem,
            filepath,
            stats,
        });
    }

    #pathnameToFilepath(pathname) {
        // Split pathname and join with public directory to build the full file path
        const parts = pathname.split('/');
        const filepath = path.join(this.#publicDirectory, ...parts);

        // Security check: ensure the resolved filepath is within the public directory.
        // We compute the relative path from public dir to the file - if it starts with
        // '..' or is absolute, the file is outside the public directory (path traversal).
        const resolvedFilepath = path.resolve(filepath);
        const relativePath = path.relative(this.#publicDirectory, resolvedFilepath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return resolvedFilepath;
    }
}
