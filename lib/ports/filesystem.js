/**
 * Filesystem port — the abstraction for file system operations used
 * throughout the Kixx framework.
 *
 * Implement this interface (as a plain module exporting named functions) to
 * support different file system backends: Node.js built-ins (node/filesystem),
 * Deno's file APIs, virtual in-memory filesystems for testing, etc.
 *
 * The current implementation is lib/node/filesystem/mod.js.
 *
 * ## Invariants
 * - readDirectory() MUST return an empty Array for non-existent directories
 *   (ENOENT) rather than rejecting; only reject on permission errors or other
 *   unexpected conditions
 * - getFileStats() MUST return null for non-existent files (ENOENT) rather
 *   than rejecting; only reject on unexpected conditions
 * - readUtf8File() MUST return null for non-existent files (ENOENT) rather
 *   than rejecting; only reject on unexpected conditions
 * - readJSONFile() MUST return null for non-existent files; MUST throw
 *   ValidationError when the file contains invalid JSON/JSONC syntax
 * - ensureDir() and ensureFile() MUST be idempotent: if the path already
 *   exists they succeed without error
 * - createReadStream() MUST return null when the path does not exist rather
 *   than throwing; only throw on unexpected conditions
 * - All path parameters accept both string paths and file:// URL objects
 *   unless otherwise noted
 *
 * @module ports/filesystem
 */

/**
 * A single entry in a directory listing.
 *
 * @typedef {Object} DirEntry
 * @property {string} name - File or directory name (not a full path)
 * @property {boolean} isDirectory - True when the entry is a directory
 * @property {boolean} isFile - True when the entry is a regular file
 * @property {boolean} isSymlink - True when the entry is a symbolic link
 */

/**
 * File system metadata for a file or directory.
 *
 * @typedef {Object} FileStats
 * @property {boolean} isDirectory - True when the path is a directory
 * @property {boolean} isFile - True when the path is a regular file
 * @property {boolean} isSymlink - True when the path is a symbolic link
 * @property {number} size - File size in bytes
 * @property {Date} atime - Last access time
 * @property {Date} mtime - Last modification time
 * @property {Date} ctime - Last status change time
 * @property {Date} birthtime - File creation time
 */

/**
 * Filesystem adapter interface. A conforming module must export all of these
 * named functions.
 *
 * @typedef {Object} Filesystem
 * @property {function(string): Promise<DirEntry[]>} readDirectory
 *   Reads a directory's contents. Returns an empty Array for non-existent
 *   directories; rejects on unexpected errors.
 * @property {function(string): Promise<FileStats|null>} getFileStats
 *   Returns stats for a file or directory, or null if it does not exist.
 * @property {function(string): Promise<string|null>} readUtf8File
 *   Reads a file as a UTF-8 string, or returns null if it does not exist.
 * @property {function(string): Promise<Object|undefined|null>} readJSONFile
 *   Reads and parses a JSON/JSONC file. Returns null if the file does not
 *   exist, undefined if the file is empty. Throws ValidationError on invalid
 *   JSON/JSONC syntax.
 * @property {function(string|URL): Promise<void>} ensureDir
 *   Creates the directory (and any intermediates) if it does not exist.
 *   Idempotent: succeeds if it already exists.
 * @property {function(string|URL): Promise<void>} ensureFile
 *   Creates an empty file (and any parent directories) if it does not exist.
 *   Idempotent: does not modify an existing file.
 * @property {function(string): Promise<*>} importAbsoluteFilepath
 *   Dynamically imports an ES module from an absolute file path.
 * @property {function(string, Object=): ReadStream|null} createReadStream
 *   Creates a readable stream for a file. Returns null if the file does
 *   not exist; throws on unexpected errors.
 * @property {function(string|URL): string} toPathString
 *   Normalizes a path string or file URL to a filesystem path string.
 */
