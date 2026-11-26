import { assert, isPlainObject, isString, isUndefined } from '../assertions/mod.js';


/**
 * @typedef {import('./content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */


/**
 * Creates a content source that holds its whole tree in memory. Tests build
 * one from literal files, and a caller with content that isn't on a file
 * system can hand it to the compiler the same way.
 *
 * @param {Object<string, (string|Uint8Array)>} files - File content by path from the root. A string is stored as its UTF-8 bytes.
 * @param {Object} [options]
 * @param {string[]} [options.symlinks=[]] - Paths that are symbolic links. A link holds nothing and is never followed.
 * @returns {ContentSourceInterface}
 * @throws {AssertionError} When a path breaks the port's path rules, a file is neither a string nor a Uint8Array, a path lies beneath a symbolic link, or a path is both a file and a directory
 */
export function createMemoryContentSource(files, options) {
    const { symlinks = [] } = options ?? {};

    assert(isPlainObject(files), 'createMemoryContentSource: files must be a plain object');
    assert(Array.isArray(symlinks), 'createMemoryContentSource: options.symlinks must be an Array');

    const encoder = new TextEncoder();
    const bytesByPath = new Map();
    const symlinkPaths = new Set();

    for (const path of Object.keys(files)) {
        const content = files[path];

        assertPath(path, 'createMemoryContentSource: a file path');
        assert(
            isString(content) || content instanceof Uint8Array,
            `createMemoryContentSource: file "${ path }" must be a string or a Uint8Array`,
        );

        // Copied, so the source doesn't change when the caller's array does.
        bytesByPath.set(path, isString(content) ? encoder.encode(content) : content.slice());
    }

    for (const path of symlinks) {
        assertPath(path, 'createMemoryContentSource: a symlink path');
        assert(!bytesByPath.has(path), `createMemoryContentSource: "${ path }" is both a file and a symbolic link`);

        symlinkPaths.add(path);
    }

    const allPaths = [ ...bytesByPath.keys(), ...symlinkPaths ];

    // A file or a link holds nothing, so no other path may lie beneath one.
    for (const path of allPaths) {
        const parent = allPaths.find((other) => isBeneath(path, other));

        if (!isUndefined(parent)) {
            const kind = symlinkPaths.has(parent) ? 'the symbolic link' : 'the file';

            assert(false, `createMemoryContentSource: "${ path }" lies beneath ${ kind } "${ parent }"`);
        }
    }

    return {
        async listFiles(directory) {
            assertPath(directory, 'listFiles: directory');

            if (symlinkPaths.has(directory)) {
                return { kind: 'symlink', entries: [] };
            }

            const entries = [];

            for (const path of bytesByPath.keys()) {
                if (isBeneath(path, directory)) {
                    entries.push({ path: path.slice(directory.length + 1), type: 'file' });
                }
            }

            for (const path of symlinkPaths) {
                if (isBeneath(path, directory)) {
                    entries.push({ path: path.slice(directory.length + 1), type: 'symlink' });
                }
            }

            // With no empty directories, a directory exists exactly when
            // something lies beneath it.
            return { kind: entries.length > 0 ? 'directory' : 'missing', entries };
        },

        async readFile(path) {
            assertPath(path, 'readFile: path');

            const bytes = bytesByPath.get(path);

            if (isUndefined(bytes)) {
                return null;
            }

            // A fresh copy each time: the caller owns the buffer it gets.
            return bytes.slice().buffer;
        },
    };
}

function isBeneath(path, directory) {
    return path.startsWith(`${ directory }/`);
}

// The port's path rules: relative, POSIX, with no empty, `.`, or `..` segment.
function assertPath(path, label) {
    const isValid = isString(path)
        && path !== ''
        && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

    assert(
        isValid,
        `${ label } must be a relative POSIX path with no empty, ".", or ".." segment (got ${ JSON.stringify(path) })`,
    );
}
