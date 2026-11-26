import fsp from 'node:fs/promises';
import path from 'node:path';
import { assert, assertNonEmptyString, isString } from '../../../../assertions/mod.js';
import { OperationalError } from '../../../../errors/mod.js';


/**
 * @typedef {import('../../../../content-compiler/content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

/**
 * @typedef {import('../../../../content-compiler/content-source-interface.js').ContentSourceEntry} ContentSourceEntry
 */


// What the file system answers when a path, or a directory on the way to it,
// doesn't exist.
const MISSING_CODES = [ 'ENOENT', 'ENOTDIR' ];


/**
 * Creates the file access the content compiler needs, over the Node.js file
 * system. Every path a method takes is checked against the port's path rules
 * before the disk is touched, so no path can leave the root directory.
 *
 * @param {string} rootDirectory - The project root; a relative path is resolved against the working directory
 * @returns {ContentSourceInterface}
 */
export function createFileSystemContentSource(rootDirectory) {
    assertNonEmptyString(rootDirectory, 'createFileSystemContentSource: rootDirectory');

    const root = path.resolve(rootDirectory);
    const resolve = (relativePath) => path.join(root, ...relativePath.split('/'));

    return {
        async listFiles(directory) {
            assertPath(directory, 'listFiles: directory');

            const directoryPath = resolve(directory);
            let stats;

            try {
                // lstat, not stat: a linked directory is reported, never entered.
                stats = await fsp.lstat(directoryPath);
            } catch (cause) {
                if (MISSING_CODES.includes(cause.code)) {
                    return { kind: 'missing', entries: [] };
                }

                throw new OperationalError(`Unable to read directory ${ directoryPath } (${ cause.code })`, { cause });
            }

            if (stats.isSymbolicLink()) {
                return { kind: 'symlink', entries: [] };
            }

            if (!stats.isDirectory()) {
                return { kind: 'missing', entries: [] };
            }

            const entries = [];
            await walkDirectory(directoryPath, '', entries);

            return { kind: 'directory', entries };
        },

        async readFile(relativePath) {
            assertPath(relativePath, 'readFile: path');

            const filepath = resolve(relativePath);
            let bytes;

            try {
                bytes = await fsp.readFile(filepath);
            } catch (cause) {
                if (MISSING_CODES.includes(cause.code) || cause.code === 'EISDIR') {
                    return null;
                }

                throw new OperationalError(`Unable to read file ${ filepath } (${ cause.code })`, { cause });
            }

            // A small Buffer is a view into a shared pool. Slicing gives the
            // caller a buffer that holds exactly this file's bytes.
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
    };
}

// Adds every file and symbolic link beneath the directory to `entries`.
// `prefix` is the POSIX path from the listed directory to this one.
async function walkDirectory(directoryPath, prefix, entries) {
    let dirents;

    try {
        dirents = await fsp.readdir(directoryPath, { withFileTypes: true });
    } catch (cause) {
        throw new OperationalError(`Unable to read directory ${ directoryPath } (${ cause.code })`, { cause });
    }

    for (const dirent of dirents) {
        // Joined with "/" on every operating system.
        const entryPath = prefix === '' ? dirent.name : `${ prefix }/${ dirent.name }`;

        // A Dirent reports the link itself, so a link is never followed.
        if (dirent.isSymbolicLink()) {
            entries.push({ path: entryPath, type: 'symlink' });
        } else if (dirent.isFile()) {
            entries.push({ path: entryPath, type: 'file' });
        } else if (dirent.isDirectory()) {
            await walkDirectory(path.join(directoryPath, dirent.name), entryPath, entries);
        }

        // A socket, a device, or a FIFO is not content. It is left out.
    }
}

// The port's path rules: relative, POSIX, with no empty, `.`, or `..` segment.
function assertPath(value, label) {
    const isValid = isString(value)
        && value !== ''
        && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

    assert(
        isValid,
        `${ label } must be a relative POSIX path with no empty, ".", or ".." segment (got ${ JSON.stringify(value) })`,
    );
}
