/**
 * @fileoverview Database document management utilities
 *
 * This module provides high-level functions for managing JSON documents
 * in a file-based database system. It wraps low-level file system operations
 * with consistent error handling and database-specific context.
 */

import path from 'node:path';
import { WrappedError } from '../errors/mod.js';

import {
    readDirectory,
    readJSONFile,
    removeFile,
    writeJSONFile
} from '../lib/file-system.js';

/**
 * Reads all entries from a database directory
 * @async
 * @param {string} directory - Path to the database directory
 * @returns {Promise<Array<import('fs').Dirent>>} Array of directory entries
 * @throws {WrappedError} When directory cannot be read or doesn't exist
 */
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

/**
 * Writes a JSON document to the database
 * @async
 * @param {string} filepath - Full path where the document should be written
 * @param {*} data - Data to be serialized as JSON and written to disk
 * @returns {Promise<void>}
 * @throws {WrappedError} When parent directory doesn't exist (ENOENT)
 * @throws {WrappedError} When write operation fails (permissions, disk full, etc.)
 */
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

/**
 * Removes a document file from the database
 * @async
 * @param {string} filepath - Path to the file to be removed
 * @returns {Promise<void>}
 * @throws {Error} When file doesn't exist or cannot be removed
 */
export async function removeDocumentFile(filepath) {
    await removeFile(filepath);
}

/**
 * Reads and parses a JSON document from the database
 * @async
 * @param {string} filepath - Path to the JSON document file
 * @returns {Promise<*>} Parsed JSON document
 * @throws {WrappedError} When file doesn't exist, contains invalid JSON, or read fails
 */
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
