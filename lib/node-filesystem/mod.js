import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


/**
 * Ensures that the directory exists, creating it and any intermediate directories
 * if they do not already exist. Equivalent to `mkdir -p`.
 *
 * This function is idempotent: if the directory already exists, it succeeds without
 * throwing. If the path already exists but is not a directory, the underlying OS
 * error is propagated.
 *
 * @public
 * @async
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
 * @async
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
 * Converts a path string or file URL to a filesystem path string.
 * Uses fileURLToPath for URL objects to handle cross-platform path encoding correctly.
 */
export function toPathString(input) {
    if (input instanceof URL) {
        return fileURLToPath(input);
    }
    return input;
}
