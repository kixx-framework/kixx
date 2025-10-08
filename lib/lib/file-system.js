import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as jsonc from '../vendor/jsonc-parser/mod.mjs';
import { ValidationError } from '../errors/mod.js';


/**
 * @typedef {Object} Dirent
 * @property {string|Buffer} name - The file name that this Dirent object refers to
 * @property {Function} isBlockDevice - Returns true if the Dirent describes a block device
 * @property {Function} isCharacterDevice - Returns true if the Dirent describes a character device
 * @property {Function} isDirectory - Returns true if the Dirent describes a file system directory
 * @property {Function} isFIFO - Returns true if the Dirent describes a first-in-first-out (FIFO) pipe
 * @property {Function} isFile - Returns true if the Dirent describes a regular file
 * @property {Function} isSocket - Returns true if the Dirent describes a socket
 * @property {Function} isSymbolicLink - Returns true if the Dirent describes a symbolic link
 */

/**
 * Reads and parses a JSON file
 *
 * @param {string} filepath - Path to the JSON file
 * @returns {Promise<Object|null>} Parsed JSON object or null if file doesn't exist
 * @throws {WrappedError} When file cannot be parsed as valid JSON
 */
export async function readJSONFile(filepath) {
    const json = await readUtf8File(filepath);

    if (!json) {
        return null;
    }

    const errors = [];

    // Parse JSONC with comment support, allowed trailing commas, and
    // allowed empty content.
    const obj = jsonc.parse(json, errors, {
        disallowComments: false,
        allowTrailingComma: true,
        allowEmptyContent: true,
    });

    if (errors.length > 0) {
        const verror = new ValidationError(`JSON parsing errors in JSON file at ${ filepath }`);

        // Collect all parsing errors for detailed feedback
        for (const parseError of errors) {
            verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
        }

        throw verror;
    }

    return obj;
}

/**
 * Writes data as JSON to a file
 *
 * @param {string} filepath - Path to the file
 * @param {Object} data - Data to serialize as JSON
 * @returns {Promise<void>} Resolves when file has been written
 * @throws {Error} When writing to the file fails
 */
export async function writeJSONFile(filepath, data) {
    await writeUtf8File(filepath, JSON.stringify(data));
}

/**
 * Reads a UTF-8 encoded text file
 *
 * @param {string} filepath - Path to the file
 * @returns {Promise<string|null>} File contents or null if file doesn't exist
 * @throws {Error} When reading the file fails for reasons other than non-existence
 */
export async function readUtf8File(filepath) {
    let utf8;
    try {
        utf8 = await fsp.readFile(filepath, { encoding: 'utf8' });
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
    return utf8;
}

/**
 * Writes a UTF-8 encoded string to a file
 *
 * @param {string} filepath - Path to the file
 * @param {string} data - String data to write
 * @returns {Promise<void>} Resolves when file has been written
 * @throws {Error} When writing to the file fails
 */
export async function writeUtf8File(filepath, data) {
    await fsp.writeFile(filepath, data, { encoding: 'utf8' });
}

/**
 * Gets file statistics
 *
 * @param {string} filepath - Path to the file
 * @returns {Promise<fs.Stats|null>} File stats object or null if file doesn't exist
 * @throws {Error} When retrieving file stats fails for reasons other than non-existence
 */
export async function getFileStats(filepath) {
    try {
        return await fsp.stat(filepath);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
}

/**
 * Creates a readable stream for a file
 *
 * @param {string} filepath - Path to the file
 * @param {Object} [options={}] - Options to pass to fs.createReadStream
 * @returns {fs.ReadStream|null} Readable stream or null if file doesn't exist
 * @throws {Error} When creating the stream fails for reasons other than non-existence
 */
export function createReadStream(filepath, options = {}) {
    try {
        return fs.createReadStream(filepath, options);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw cause;
    }
}

/**
 * Creates a writable stream for a file
 *
 * @param {string} filepath - Path to the file
 * @param {Object} [options={}] - Options to pass to fs.createWriteStream
 * @returns {fs.WriteStream} Writable stream
 * @throws {Error} When creating the stream fails
 */
export function createWriteStream(filepath, options = {}) {
    return fs.createWriteStream(filepath, options);
}

/**
 * Dynamically imports an ES module from an absolute file path. This is useful for
 * dynamically importing modules on Windows systems.
 *
 * @param {string} filepath - Absolute path to the file
 * @returns {Promise<Module>} Imported module
 * @throws {Error} When the module cannot be imported
 */
export function importAbsoluteFilepath(filepath) {
    return import(pathToFileURL(filepath));
}

/**
 * Reads directory contents
 *
 * @param {string} directory - Path to the directory
 * @returns {Promise<Dirent[]>} Array of directory entries
 * @throws {Error} When reading the directory fails for reasons other than non-existence
 */
export async function readDirectory(directory) {
    try {
        const entries = await fsp.readdir(directory, {
            recursive: false,
            withFileTypes: true,
        });
        return entries;
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }
}

/**
 * Reads directory contents recursively
 *
 * @param {string} directory - Path to the directory
 * @returns {Promise<Dirent[]>} Array of directory entries including subdirectories
 * @throws {Error} When reading the directory fails for reasons other than non-existence
 */
export async function readDirectoryRecursively(directory) {
    try {
        // withFileTypes: true returns Dirent objects instead of string filenames
        const entries = await fsp.readdir(directory, {
            recursive: true,
            withFileTypes: true,
        });
        return entries;
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }
}

/**
 * Renames (moves) a file
 *
 * @param {string} oldFilepath - Current path of the file
 * @param {string} newFilepath - New path for the file
 * @returns {Promise<void>} Resolves when file has been renamed
 * @throws {Error} When the file cannot be renamed
 */
export async function rename(oldFilepath, newFilepath) {
    await fsp.rename(oldFilepath, newFilepath);
}

/**
 * Removes a file
 *
 * @param {string} filepath - Path to the file
 * @returns {Promise<void>} Resolves when file has been removed
 * @throws {Error} When the file cannot be removed
 */
export async function removeFile(filepath) {
    // Use force: true to ignore non-existent files (no error if file doesn't exist)
    await fsp.rm(filepath, { force: true });
}
