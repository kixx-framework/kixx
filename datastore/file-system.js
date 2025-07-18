import path from 'node:path';
import { WrappedError } from '../errors/mod.js';

import {
    readDirectory,
    readJSONFile,
    removeFile,
    writeJSONFile
} from '../lib/file-system.js';


export async function readDocumentDirectory(directory) {
    let entries;
    try {
        entries = await readDirectory(directory);
    } catch (cause) {
        throw new WrappedError(
            `Unable to read database directory ${ directory }`,
            { cause }
        );
    }
    return entries;
}

export async function writeDocumentFile(filepath, data) {
    try {
        await writeJSONFile(filepath, data);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            throw new WrappedError(
                `Database directory does not exist: ${ path.dirname(filepath) }`,
                { cause }
            );
        }
        throw new WrappedError(
            `Unable to write database file to ${ filepath }`,
            { cause }
        );
    }
}

export async function removeDocumentFile(filepath) {
    await removeFile(filepath);
}

export async function readDocumentFile(filepath) {
    let document;
    try {
        document = await readJSONFile(filepath);
    } catch (cause) {
        throw new WrappedError(
            `Unable to read database file from ${ filepath }`,
            { cause }
        );
    }
    return document;
}
