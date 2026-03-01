import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { jsonc } from '../vendor/mod.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ValidationError } from '../errors.js';


/**
 * @typedef {Object} DirEntry
 * @property {string} name - File or directory name (not a full path)
 * @property {boolean} isDirectory - True when the entry is a directory
 * @property {boolean} isFile - True when the entry is a regular file
 * @property {boolean} isSymlink - True when the entry is a symbolic link
 */

/**
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
 * Reads the contents of a directory, returning plain objects with file type information.
 *
 * Returns an empty array for non-existent directories rather than throwing an error.
 *
 * Notice that readDirectory() returns plain objects rather than file name strings.
 * This can be helpful to avoid repeatedly calling stat() to get file information.
 *
 * @public
 * @param {string} directory - Absolute or relative path to the directory
 * @returns {Promise<DirEntry[]>} Array of entries representing files and subdirectories (non-recursive)
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

        return entries.map((nodeDirEnt) => {
            return {
                name: nodeDirEnt.name,
                isDirectory: nodeDirEnt.isDirectory(),
                isFile: nodeDirEnt.isFile(),
                isSymlink: nodeDirEnt.isSymbolicLink(),
            };
        });

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
 * Retrieves file system information for a file or directory.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @param {string} filepath - Absolute or relative path to the file or directory
 * @returns {Promise<FileStats|null>} File stats object, or null if the file doesn't exist
 * @throws {Error} When retrieving file stats fails for reasons other than non-existence (e.g., permission denied)
 */
export async function getFileStats(filepath) {
    try {
        const nodeStats = await fsp.stat(filepath);

        return {
            isDirectory: nodeStats.isDirectory(),
            isFile: nodeStats.isFile(),
            isSymlink: nodeStats.isSymbolicLink(),
            size: nodeStats.size,
            atime: nodeStats.atime,
            mtime: nodeStats.mtime,
            ctime: nodeStats.ctime,
            birthtime: nodeStats.birthtime,
        };
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
 * Reads the contents of a UTF-8 encoded text file.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
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
 * Reads and parses a JSON or JSONC file from the filesystem.
 *
 * Supports JSON with Comments (JSONC) including comments and trailing commas.
 *
 * Returns null for non-existent files rather than throwing an error, allowing
 * callers to check for file existence without exception handling.
 *
 * @public
 * @param {string} filepath - Absolute or relative path to the JSON/JSONC file
 * @returns {Promise<Object|undefined|null>} Parsed JSON object, undefined if the file is empty, or null if the file doesn't exist
 * @throws {ValidationError} When the file contains invalid JSON/JSONC syntax (includes details for all parsing errors)
 */
export async function readJSONFile(filepath) {
    const json = await readUtf8File(filepath);

    if (json === null) {
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
        const verror = new ValidationError(`JSON parsing errors in JSON file at ${ filepath }`, { expected: false });

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
 * Ensures that the directory exists, creating it and any intermediate directories
 * if they do not already exist. Equivalent to `mkdir -p`.
 *
 * This function is idempotent: if the directory already exists, it succeeds without
 * throwing. If the path already exists but is not a directory, the underlying OS
 * error is propagated.
 *
 * @public
 * @param {string|URL} dir - Path to the directory to ensure
 * @returns {Promise<void>} Resolves when the directory exists
 * @throws {Error} When the directory cannot be created (e.g., permission denied, path is an existing non-directory)
 */
export async function ensureDir(dir) {
    // recursive: true creates intermediate directories as needed and does not throw
    // when the directory already exists, making this operation idempotent
    await fsp.mkdir(dir, { recursive: true });
}

/**
 * Ensures that a regular file exists at the given path. If the file does not exist,
 * it is created as an empty file. If the parent directories for the file do not exist,
 * they are created automatically.
 *
 * This function is idempotent: if the file already exists, it succeeds without
 * modifying the file's contents.
 *
 * @public
 * @param {string|URL} filePath - Path to the file to ensure
 * @returns {Promise<void>} Resolves when the file exists
 * @throws {Error} When creating the file or its parent directories fails (e.g., permission denied)
 */
export async function ensureFile(filePath) {
    try {
        await fsp.lstat(filePath);
    } catch (cause) {
        if (cause.code !== 'ENOENT') {
            throw cause;
        }

        // File doesn't exist — create the parent directory tree first, then
        // open the file with the 'a' (append) flag. The 'a' flag creates the
        // file if it doesn't exist without truncating it if it was created
        // concurrently between our lstat() and open() calls
        const parentDir = path.dirname(toPathString(filePath));
        await fsp.mkdir(parentDir, { recursive: true });
        const fileHandle = await fsp.open(filePath, 'a');
        await fileHandle.close();
    }
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
 * Normalizes a path string or file URL to a filesystem path string, handling cross-platform
 * path encoding correctly (e.g., Windows drive letters, URL-encoded characters).
 *
 * @public
 * @param {string|URL} input - Path string or file URL to normalize
 * @returns {string} Filesystem path string
 */
export function toPathString(input) {
    if (input instanceof URL) {
        return fileURLToPath(input);
    }
    return input;
}
