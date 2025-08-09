import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';


/**
 * Reads a JSON file from the given filepath and parses its contents.
 *
 * @param {string} filepath - The path to the JSON file to read.
 * @returns {Promise<Object|null>} The parsed JSON object, or null if the file does not exist or is empty.
 * @throws {WrappedError} If the file cannot be parsed as valid JSON.
 */
export async function readJSONFile(filepath) {
    const utf8 = await readUtf8File(filepath);

    if (!utf8) {
        return null;
    }

    try {
        return JSON.parse(utf8);
    } catch (cause) {
        throw new WrappedError(
            `Unable to parse JSON file ${ filepath }: ${ cause.message }`,
            { cause }
        );
    }
}

/**
 * Writes the given data as JSON to the specified file.
 *
 * @param {string} filepath - The path to the file where JSON data will be written.
 * @param {Object} data - The data to serialize and write as JSON.
 * @returns {Promise<void>} Resolves when the file has been written.
 * @throws {Error} If writing to the file fails.
 */
export async function writeJSONFile(filepath, data) {
    await writeUtf8File(filepath, JSON.stringify(data));
}

/**
 * Reads a UTF-8 encoded text file from the given filepath.
 *
 * @param {string} filepath - The path to the file to read.
 * @returns {Promise<string|null>} The file contents as a string, or null if the file does not exist.
 * @throws {Error} If reading the file fails for reasons other than non-existence.
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
 * Writes a UTF-8 encoded string to the specified file.
 *
 * @param {string} filepath - The path to the file where the data will be written.
 * @param {string} data - The string data to write to the file.
 * @returns {Promise<void>} Resolves when the file has been written.
 * @throws {Error} If writing to the file fails.
 */
export async function writeUtf8File(filepath, data) {
    await fsp.writeFile(filepath, data, { encoding: 'utf8' });
}

/**
 * Retrieves the file statistics for the specified file path.
 *
 * @param {string} filepath - The path to the file whose stats are to be retrieved.
 * @returns {Promise<fs.Stats|null>} A promise that resolves to the file stats object,
 *   or null if the file does not exist.
 * @throws {Error} If retrieving the file stats fails for reasons other than non-existence.
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
 * Creates a readable stream for the specified file.
 *
 * @param {string} filepath - The path to the file to read.
 * @param {Object} [options={}] - Optional options to pass to fs.createReadStream.
 * @returns {fs.ReadStream|null} The readable stream, or null if the file does not exist.
 * @throws {Error} If creating the stream fails for reasons other than non-existence.
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
 * Creates a writable stream for the specified file.
 *
 * @param {string} filepath - The path to the file to write.
 * @param {Object} [options={}] - Optional options to pass to fs.createWriteStream.
 * @returns {fs.WriteStream} The writable stream.
 */
export function createWriteStream(filepath, options = {}) {
    return fs.createWriteStream(filepath, options);
}

/**
 * Dynamically imports an ES module from an absolute file path.
 *
 * @param {string} filepath - The absolute path to the file to import.
 * @returns {Promise<Module>} A promise that resolves to the imported module.
 */
export function importAbsoluteFilepath(filepath) {
    return import(pathToFileURL(filepath));
}

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

export async function readDirectoryRecursively(directory) {
    try {
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
 * Renames (moves) a file from oldFilepath to newFilepath.
 *
 * @param {string} oldFilepath - The current path of the file.
 * @param {string} newFilepath - The new path for the file.
 * @returns {Promise<void>} Resolves when the file has been renamed.
 * @throws {Error} If the file cannot be renamed.
 */
export async function rename(oldFilepath, newFilepath) {
    await fsp.rename(oldFilepath, newFilepath);
}

/**
 * Remove a file.
 *
 * @param {string} filepath - Path to the file to remove
 * @throws {Error} If file cannot be removed
 */
export async function removeFile(filepath) {
    await fsp.rm(filepath, { force: true });
}
