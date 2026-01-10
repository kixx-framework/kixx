import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as jsonc from '../vendor/jsonc-parser/mod.mjs';
import { ValidationError } from '../errors/mod.js';


/**
 * @typedef {fs.Dirent} Dirent
 *
 * Directory entry object returned by readDirectory() and readDirectoryRecursively().
 * Provides file type methods (isFile, isDirectory, etc.) to determine entry type
 * without additional stat() system calls.
 *
 * @public
 * @property {string} name - The file name, excluding the full path
 * @property {string} parentPath - The path of the parent directory
 * @property {Function} isDirectory - Returns true if the entry represents a directory
 * @property {Function} isFile - Returns true if the entry represents a regular file
 */

/**
 * Reads and parses a JSON or JSONC file from the filesystem.
 *
 * Supports JSON with Comments (JSONC) including comments and trailing commas.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the JSON/JSONC file
 * @returns {Promise<Object|null>} Parsed JSON object, or null if the file doesn't exist
 * @throws {ValidationError} When the file contains invalid JSON/JSONC syntax (includes details for all parsing errors)
 */
export async function readJSONFile(filepath) {
    const json = await readUtf8File(filepath);

    if (!json) {
        return null;
    }

    const errors = [];

    // Parse JSONC with comment support, allowed trailing commas, and
    // allowed empty content. The errors array is populated by the parser
    // with all syntax errors found, allowing us to report multiple issues
    // at once rather than stopping at the first error.
    const obj = jsonc.parse(json, errors, {
        disallowComments: false,
        allowTrailingComma: true,
        allowEmptyContent: true,
    });

    if (errors.length > 0) {
        const verror = new ValidationError(`JSON parsing errors in JSON file at ${ filepath }`);

        // Collect all parsing errors to provide comprehensive feedback
        // about all syntax issues in the file, not just the first one
        for (const parseError of errors) {
            verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
        }

        throw verror;
    }

    return obj;
}

/**
 * Serializes data as JSON and writes it to a file.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the file
 * @param {Object} data - Data object to serialize as JSON
 * @returns {Promise<void>} Resolves when the file has been written
 * @throws {Error} When writing to the file fails (e.g., permission denied, disk full)
 */
export async function writeJSONFile(filepath, data) {
    await writeUtf8File(filepath, JSON.stringify(data));
}

/**
 * Reads the contents of a UTF-8 encoded text file.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the file
 * @returns {Promise<string|null>} File contents as a UTF-8 string, or null if the file doesn't exist
 * @throws {Error} When reading the file fails for reasons other than non-existence (e.g., permission denied)
 */
export async function readUtf8File(filepath) {
    let utf8;
    try {
        utf8 = await fsp.readFile(filepath, { encoding: 'utf8' });
    } catch (cause) {
        // ENOENT means the file doesn't exist. Treat this as a normal
        // condition (return null) rather than an error.
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
    return utf8;
}

/**
 * Writes a UTF-8 encoded string to a file.
 *
 * Creates the file if it doesn't exist or overwrites it if it does. Does *not*
 * ensure that parent directories exist.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the file
 * @param {string} data - UTF-8 string data to write
 * @returns {Promise<void>} Resolves when the file has been written
 * @throws {Error} When writing to the file fails (e.g., permission denied, disk full)
 */
export async function writeUtf8File(filepath, data) {
    await fsp.writeFile(filepath, data, { encoding: 'utf8' });
}

/**
 * Retrieves file system information for a file or directory.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the file or directory
 * @returns {Promise<fs.Stats|null>} File stats object containing size, timestamps, permissions, etc., or null if the file doesn't exist
 * @throws {Error} When retrieving file stats fails for reasons other than non-existence (e.g., permission denied)
 */
export async function getFileStats(filepath) {
    try {
        return await fsp.stat(filepath);
    } catch (cause) {
        // ENOENT means the file doesn't exist. Treat this as a normal
        // condition (return null) rather than an error.
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
}

/**
 * Creates a readable stream for reading from a file.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @param {string} filepath - Absolute or relative path to the file
 * @param {Object} [options={}] - Stream options (encoding, start, end, highWaterMark, etc.) passed to fs.createReadStream
 * @returns {fs.ReadStream|null} Readable stream instance, or null if the file path validation fails immediately
 * @throws {Error} When creating the stream fails for reasons other than non-existence (e.g., invalid options)
 */
export function createReadStream(filepath, options = {}) {
    try {
        return fs.createReadStream(filepath, options);
    } catch (cause) {
        // ENOENT means the file doesn't exist. Treat this as a normal
        // condition (return null) rather than an error.
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
}

/**
 * Creates a writable stream for writing to a file.
 *
 * The file will be created if it doesn't exist, or truncated if it does.
 *
 * @public
 * @param {string} filepath - Absolute or relative path to the file
 * @param {Object} [options={}] - Stream options (encoding, flags, highWaterMark, etc.) passed to fs.createWriteStream
 * @returns {fs.WriteStream} Writable stream instance
 * @throws {Error} When creating the stream fails (e.g., invalid path, permission denied)
 */
export function createWriteStream(filepath, options = {}) {
    return fs.createWriteStream(filepath, options);
}

/**
 * Dynamically imports an ES module from an absolute file path using a file:// URL.
 *
 * This is helpful for cross platform use between MacOS, Linux, and Windows because Node.js
 * dynamic import() with absolute Windows paths (e.g., C:\path\to\file.js) fails,
 * but file:// URLs work cross-platform.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute path to the module file
 * @returns {Promise<Module>} The imported ES module object with all exports
 * @throws {Error} When the module cannot be imported (e.g., file doesn't exist, syntax error, module not found)
 */
export function importAbsoluteFilepath(filepath) {
    // Convert file path to file:// URL - required on Windows because Node.js
    // dynamic import() with absolute Windows paths (C:\path\to\file) fails,
    // but file:// URLs work cross-platform. On Unix systems this is harmless.
    return import(pathToFileURL(filepath));
}

/**
 * Reads the contents of a directory, returning Dirent objects with file type information.
 *
 * Returns an empty array for non-existent directories rather than throwing an error.
 *
 * Notice that readDirectory() returns Node.js fs.Dirent objects rather than file name strings.
 * This can be helpful to avoid repeatedly calling stat() to get file information.
 *
 * @public
 * @async
 * @param {string} directory - Absolute or relative path to the directory
 * @returns {Promise<Dirent[]>} Array of Dirent objects representing files and subdirectories (non-recursive)
 * @throws {Error} When reading the directory fails for reasons other than non-existence (e.g., permission denied, not a directory)
 */
export async function readDirectory(directory) {
    try {
        const entries = await fsp.readdir(directory, {
            recursive: false,
            // withFileTypes: true returns Dirent objects with file type methods
            // (isFile, isDirectory, etc.) instead of just string filenames,
            // which allows efficient filtering without additional stat() calls
            withFileTypes: true,
        });
        return entries;
    } catch (cause) {
        // ENOENT means the file doesn't exist. Treat this as a normal
        // condition (return empty array) rather than an error.
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }
}

/**
 * Reads the contents of a directory recursively, returning Dirent objects for all
 * files and subdirectories in the directory tree.
 *
 * Returns an empty array for non-existent directories rather than throwing an error.
 *
 * Notice that readDirectory() returns Node.js fs.Dirent objects rather than file name strings.
 * This can be helpful to avoid repeatedly calling stat() to get file information.
 *
 * @public
 * @async
 * @param {string} directory - Absolute or relative path to the directory
 * @returns {Promise<Dirent[]>} Array of Dirent objects representing all files and subdirectories recursively
 * @throws {Error} When reading the directory fails for reasons other than non-existence (e.g., permission denied, not a directory)
 */
export async function readDirectoryRecursively(directory) {
    try {
        // withFileTypes: true returns Dirent objects with file type methods
        // (isFile, isDirectory, etc.) instead of string filenames, avoiding
        // the need for additional stat() calls to determine file types
        const entries = await fsp.readdir(directory, {
            recursive: true,
            withFileTypes: true,
        });
        return entries;
    } catch (cause) {
        // ENOENT means the file doesn't exist. Treat this as a normal
        // condition (return empty array) rather than an error.
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }
}

/**
 * Renames or moves a file or directory from one path to another.
 *
 * Can be used to rename a file within the same directory or move it to a different location.
 *
 * @public
 * @async
 * @param {string} oldFilepath - Current absolute or relative path of the file or directory
 * @param {string} newFilepath - New absolute or relative path for the file or directory
 * @returns {Promise<void>} Resolves when the file or directory has been renamed
 * @throws {Error} When the rename operation fails (e.g., file doesn't exist, permission denied, target exists)
 */
export async function rename(oldFilepath, newFilepath) {
    await fsp.rename(oldFilepath, newFilepath);
}

/**
 * Removes a file from the filesystem.
 *
 * This operation is idempotent - if the file doesn't exist, it succeeds silently without
 * throwing an error, allowing callers to use it as an "ensure deleted" operation.
 *
 * @public
 * @async
 * @param {string} filepath - Absolute or relative path to the file
 * @returns {Promise<void>} Resolves when the file has been removed or if it doesn't exist
 * @throws {Error} When removing the file fails for reasons other than non-existence (e.g., permission denied, is a directory)
 */
export async function removeFile(filepath) {
    // force: true makes this operation idempotent - if the file doesn't exist, it succeeds
    // silently rather than throwing ENOENT. This allows callers to use removeFile as an
    // "ensure deleted" operation without checking existence first
    await fsp.rm(filepath, { force: true });
}
