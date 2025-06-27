import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';


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

export async function writeJSONFile(filepath, data) {
    await writeUtf8File(filepath, JSON.stringify(data));
}

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

export async function writeUtf8File(filepath, data) {
    await fsp.writeFile(filepath, data, { encoding: 'utf8' });
}

export function getFileStats(filepath) {
    return fsp.stat(filepath);
}

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

export function createWriteStream(filepath, options = {}) {
    return fs.createWriteStream(filepath, options);
}

export function importAbsoluteFilepath(filepath) {
    return import(pathToFileURL(filepath));
}

/**
 * Read the contents of a directory. Returns an empty array if the directory does not exist.
 *
 * @param {string} directory - Path to the directory to read
 * @returns {Promise<string[]>} Array of filenames or full paths if includeFullPaths is true
 * @throws {Error} If directory cannot be read for reasons other than not existing
 */
export async function readDirectory(directory) {
    let entries;
    try {
        entries = await fsp.readdir(directory);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }

    return entries.map((entry) => path.join(directory, entry));
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
