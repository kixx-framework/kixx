import { AssertionError, isPlainObject, isString } from '../assertions/mod.js';
import { sha256Hex } from '../utils/crypto.js';
import { PATH_CLASSES, createPathClassifier, findProjectPathProblem } from './classify-path.js';


/**
 * The fingerprint format version. It is part of every fingerprint
 * (`kxfp1:`) and of the hashed header. Any change to what is hashed, to the
 * path classification, or to the entry rules is a new version.
 * @type {number}
 */
export const CODE_FINGERPRINT_FORMAT = 1;

/**
 * The git file modes a recursive tree listing can hold: a regular file, an
 * executable file, a symbolic link, and a gitlink (submodule).
 * @type {ReadonlyArray<string>}
 */
export const GIT_FILE_MODES = Object.freeze([ '100644', '100755', '120000', '160000' ]);

const HEADER = `kixx code fingerprint ${ CODE_FINGERPRINT_FORMAT }\n`;

const PREFIX = `kxfp${ CODE_FINGERPRINT_FORMAT }:`;

const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// Any format version, so a server accepts a later format with no change.
const CODE_FINGERPRINT_PATTERN = /^kxfp[1-9][0-9]*:[0-9a-f]{64}$/;


/**
 * @typedef {Object} GitTreeEntry - One file in a commit's tree
 * @property {string} path - POSIX path from the project root, with no leading `/`
 * @property {string} mode - One of GIT_FILE_MODES
 * @property {string} oid - The git object id: 40 (SHA-1) or 64 (SHA-256) lowercase hex
 */

/**
 * @typedef {import('../tooling/project-paths.js').PluginContentRoot} PluginContentRoot
 */


/**
 * Tells whether a value is a git object id, such as a commit id: 40 or 64
 * lowercase hex characters.
 * @param {*} value
 * @returns {boolean}
 */
export function isValidGitObjectId(value) {
    return isString(value) && GIT_OBJECT_ID_PATTERN.test(value);
}

/**
 * Tells whether a value has the shape of a code fingerprint in any format
 * version: `kxfp<version>:` and 64 lowercase hex characters.
 * @param {*} value
 * @returns {boolean}
 */
export function isValidCodeFingerprint(value) {
    return isString(value) && CODE_FINGERPRINT_PATTERN.test(value);
}

/**
 * Computes the code fingerprint of one commit from every file in its tree.
 *
 * It keeps the entries classified as code (D40), sorts them by the UTF-8
 * bytes of the path, and hashes the header `kixx code fingerprint 1\n`
 * followed by `<mode> <oid>\t<path>\0` for each one with SHA-256. Entries may
 * come in any order.
 *
 * @param {Object} options
 * @param {GitTreeEntry[]} options.entries - Every file in the commit's tree, as from parseGitLsTree()
 * @param {PluginContentRoot[]} [options.contentRoots=[]] - The installed content roots, as for createPathClassifier()
 * @returns {Promise<string>} `kxfp1:` followed by 64 lowercase hex characters
 * @throws {AssertionError} When an entry is malformed, two entries share a path, or oid lengths are mixed
 */
export async function computeCodeFingerprint(options) {
    const { entries, contentRoots } = options ?? {};

    if (!Array.isArray(entries)) {
        throw new AssertionError('computeCodeFingerprint: entries must be an array', null, computeCodeFingerprint);
    }

    const classify = createPathClassifier(contentRoots);
    const encoder = new TextEncoder();
    const seenPaths = new Set();
    const codeEntries = [];
    let oidLength = null;

    entries.forEach((entry, index) => {
        assertEntry(entry, index);

        if (oidLength === null) {
            oidLength = entry.oid.length;
        } else if (entry.oid.length !== oidLength) {
            fail(index, 'has an oid of a different length than earlier entries (SHA-1 and SHA-256 ids are not mixed)');
        }

        if (seenPaths.has(entry.path)) {
            fail(index, `repeats the path ${ JSON.stringify(entry.path) }`);
        }
        seenPaths.add(entry.path);

        if (classify(entry.path) === PATH_CLASSES.CODE) {
            codeEntries.push({ entry, pathBytes: encoder.encode(entry.path) });
        }
    });

    codeEntries.sort((a, b) => compareBytes(a.pathBytes, b.pathBytes));

    let serialized = HEADER;
    for (const { entry } of codeEntries) {
        serialized += `${ entry.mode } ${ entry.oid }\t${ entry.path }\0`;
    }

    return PREFIX + await sha256Hex(serialized);
}


function assertEntry(entry, index) {
    if (!isPlainObject(entry)) {
        fail(index, 'must be a plain object');
    }

    const problem = findProjectPathProblem(entry.path);
    if (problem) {
        fail(index, `path ${ JSON.stringify(entry.path) } ${ problem }`);
    }
    if (!GIT_FILE_MODES.includes(entry.mode)) {
        fail(index, `(${ entry.path }) has mode ${ JSON.stringify(entry.mode) }; expected one of ${ GIT_FILE_MODES.join(', ') }`);
    }
    if (!isValidGitObjectId(entry.oid)) {
        fail(index, `(${ entry.path }) has oid ${ JSON.stringify(entry.oid) }; expected 40 or 64 lowercase hex characters`);
    }
}

function fail(index, message) {
    throw new AssertionError(`computeCodeFingerprint: entry ${ index } ${ message }`, null, computeCodeFingerprint);
}

function compareBytes(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return a.length - b.length;
}
