import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as fileSystem from '../lib/file-system.js';
import { getContentTypeForFileExtension } from '../lib/http-utils.js';


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
     * @param {Object} config - File configuration
     * @param {string} config.filepath - Absolute path to the file
     * @param {Object} config.stats - Node.js fs.Stats object with file metadata
     * @param {Object} [config.fileSystem] - File system abstraction for I/O operations
     */
    constructor(config) {
        this.#stats = config.stats;
        this.#fileSystem = config.fileSystem || fileSystem;

        /**
         * Absolute path to the file on the filesystem
         * @name filepath
         * @readonly
         * @type {string|null}
         */
        Object.defineProperty(this, 'filepath', {
            enumerable: true,
            value: config.filepath,
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
     * @async
     * @returns {Promise<string>} Hexadecimal string representation of the MD5 hash
     * @throws {Error} When the file cannot be read or the stream fails
     */
    async computeHash() {
        const fileInputStream = this.createReadStream();

        // MD5 is used here for generating cache keys/ETags, not for cryptographic
        // security. MD5 is fast and sufficient for detecting file changes.
        const hash = crypto.createHash('md5').setEncoding('hex');

        // Pipe the file stream through the hash transform stream
        fileInputStream.pipe(hash);

        // Collect the hash output by listening to data events and aggregating chunks
        return new Promise((resolve, reject) => {
            let result = '';

            // Aggregate hash chunks as they're emitted
            hash.on('data', (chunk) => {
                result += chunk;
            });

            // Resolve with the complete hash when stream ends
            hash.on('end', () => {
                resolve(result);
            });

            // Handle any errors during streaming or hashing
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
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.publicDirectory] - Absolute path to the public static files directory
     * @param {Object} [options.fileSystem] - File system abstraction (defaults to lib/file-system.js for testing purposes)
     */
    constructor(options) {
        options = options || {};

        this.#publicDirectory = options.publicDirectory;
        this.#fileSystem = options.fileSystem || fileSystem;
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
     * @async
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
        if (!stats || !stats.isFile()) {
            return null;
        }

        return new File({
            fileSystem: this.#fileSystem,
            filepath,
            stats,
        });
    }

    /**
     * Writes file content from a request stream to the specified pathname within the public directory.
     *
     * Streams the incoming request data directly to disk without buffering the entire file in memory,
     * making it suitable for large file uploads. The method validates that the resolved path remains
     * within the public directory to prevent path traversal attacks.
     *
     * Returns null if the pathname is invalid or would resolve outside the public directory.
     * The file is overwritten if it already exists.
     *
     * This method validates that the resolved path remains within the public directory
     * to prevent path traversal attacks. Requests attempting to write to parent directories
     * (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} pathname - Relative path where the file should be written (e.g., '/css/style.css', 'images/logo.png')
     * @param {stream.Readable} incomingStream - A Node.js Readable stream for the file data
     * @returns {Promise<string|null>} The pathname if the file was successfully written, or null if the path is invalid
     * @throws {Error} When the stream pipeline fails (e.g., disk full, permission denied, stream errors)
     */
    async putFile(pathname, incomingStream) {
        const filepath = this.#pathnameToFilepath(pathname);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        const destination = this.#fileSystem.createWriteStream(filepath);

        // Pipeline the streams to create a Promise.
        await pipeline(incomingStream, destination);

        return pathname;
    }

    /**
     * Deletes a file from the public directory.
     *
     * Returns null if the pathname is invalid or would resolve outside the public directory.
     * The operation is idempotent - if the file doesn't exist, it succeeds silently.
     *
     * This method validates that the resolved path remains within the public directory
     * to prevent path traversal attacks. Requests attempting to delete files in parent
     * directories (e.g., '../../etc/passwd') will return null.
     * @public
     * @async
     * @param {string} pathname - Relative path to the file to delete (e.g., '/css/style.css', 'images/logo.png')
     * @returns {Promise<string|null>} The pathname if the file was successfully deleted, or null if the path is invalid
     * @throws {Error} When the delete operation fails (e.g., permission denied, path is a directory with contents)
     */
    async deleteFile(pathname) {
        const filepath = this.#pathnameToFilepath(pathname);

        // If the filepath is not returned, then we assume the path is invalid.
        if (!filepath) {
            return null;
        }

        await this.#fileSystem.removeFile(filepath);

        return pathname;
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
