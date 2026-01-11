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
     * Absolute path to the file on the filesystem
     * @type {string|null}
     */
    #filepath = null;

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
        this.#filepath = config.filepath;
        this.#stats = config.stats;
        this.#fileSystem = config.fileSystem || fileSystem;
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
        return getContentTypeForFileExtension(path.extname(this.#filepath));
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
        const hash = crypto.createHash('md5');

        // Stream the file through the hash to avoid loading entire file into memory,
        // which is important for large static assets (images, videos, bundles)
        const hex = await pipeline(fileInputStream, hash.setEncoding('hex'));
        return hex;
    }

    /**
     * Creates a readable stream for streaming the file contents.
     * @public
     * @returns {ReadStream} Node.js readable stream for the file
     */
    createReadStream() {
        return this.#fileSystem.createReadStream(this.#filepath);
    }
}

/**
 * Manages retrieval of static files from a public directory for serving via HTTP.
 *
 * Provides safe access to static files (CSS, JavaScript, images, etc.) by verifying
 * that requested files exist and are regular files (not directories). Returns File
 * instances with metadata and streaming capabilities for efficient content delivery.
 *
 * Security Note: The caller must sanitize pathnames before passing to getFile() to
 * prevent path traversal attacks. This class does not validate that resolved paths
 * remain within the public directory.
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
     * SECURITY WARNING: This method assumes pathname has been sanitized by the caller
     * to remove path traversal sequences like '..' to prevent accessing files outside
     * the public directory. The caller must validate the resolved path.
     * @public
     * @async
     * @param {string} pathname - Relative path to the file (e.g., '/css/style.css', 'images/logo.png')
     * @returns {Promise<File|null>} File instance with metadata and streaming access, or null if not found or is a directory
     */
    async getFile(pathname) {
        // Split pathname and join with public directory to build the full file path.
        // Note: This assumes pathname is already sanitized by the caller to prevent
        // path traversal attacks (e.g., removing '..' segments). The caller should
        // validate that the resolved path stays within publicDirectory.
        const parts = pathname.split('/');
        const filepath = path.join(this.#publicDirectory, ...parts);

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
}
