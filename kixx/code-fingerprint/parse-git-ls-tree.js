import { ValidationError } from '../errors/mod.js';
import { isString } from '../assertions/mod.js';
import { GIT_FILE_MODES, isValidGitObjectId } from './code-fingerprint.js';


// `<mode> SP <type> SP <oid> TAB <path>`. A `-z` listing never quotes a path.
const RECORD_PATTERN = /^([0-9]+) ([a-z]+) ([^\t]*)\t([\s\S]+)$/;

// A recursive listing holds files (blobs) and gitlinks (commits), never trees.
const TYPES_BY_MODE = new Map([
    [ '100644', 'blob' ],
    [ '100755', 'blob' ],
    [ '120000', 'blob' ],
    [ '160000', 'commit' ],
]);


/**
 * Parses the output of `git ls-tree -r -z <commit>` into the entries
 * computeCodeFingerprint() takes.
 *
 * Pass the raw bytes. A path that isn't valid UTF-8 is refused, since its
 * bytes couldn't round-trip through a string.
 *
 * @param {ArrayBuffer|Uint8Array|string} output - git's standard output
 * @returns {Array<{path: string, mode: string, oid: string}>} One entry per record, in git's order
 * @throws {ValidationError} When a record is malformed; the message quotes its index
 */
export function parseGitLsTree(output) {
    const records = splitRecords(output);
    const entries = [];

    records.forEach((record, index) => {
        const text = isString(record) ? record : decodeRecord(record, index);
        const match = RECORD_PATTERN.exec(text);

        if (!match) {
            fail(index, 'is not "<mode> <type> <oid>\\t<path>"');
        }

        const [ , mode, type, oid, path ] = match;

        if (!GIT_FILE_MODES.includes(mode)) {
            fail(index, `has mode ${ JSON.stringify(mode) }; expected one of ${ GIT_FILE_MODES.join(', ') }`);
        }
        if (TYPES_BY_MODE.get(mode) !== type) {
            fail(index, `has type ${ JSON.stringify(type) } with mode ${ mode }; expected ${ TYPES_BY_MODE.get(mode) }`);
        }
        if (!isValidGitObjectId(oid)) {
            fail(index, `has oid ${ JSON.stringify(oid) }; expected 40 or 64 lowercase hex characters`);
        }

        entries.push({ path, mode, oid });
    });

    return entries;
}


// Splits on NUL. The listing ends with a NUL, so the last piece is empty.
function splitRecords(output) {
    if (isString(output)) {
        return dropTrailingEmpty(output.split('\0'), (piece) => piece === '');
    }

    let bytes;
    if (output instanceof Uint8Array) {
        bytes = output;
    } else if (output instanceof ArrayBuffer) {
        bytes = new Uint8Array(output);
    } else {
        throw new ValidationError('parseGitLsTree: output must be an ArrayBuffer, a Uint8Array, or a string', null, parseGitLsTree);
    }

    const records = [];
    let start = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] === 0) {
            records.push(bytes.subarray(start, i));
            start = i + 1;
        }
    }
    records.push(bytes.subarray(start));

    return dropTrailingEmpty(records, (piece) => piece.length === 0);
}

function dropTrailingEmpty(pieces, isEmpty) {
    if (pieces.length > 0 && isEmpty(pieces[pieces.length - 1])) {
        pieces.pop();
    }
    return pieces;
}

function decodeRecord(bytes, index) {
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        fail(index, 'is not valid UTF-8');
    }
    return null;
}

function fail(index, message) {
    throw new ValidationError(`parseGitLsTree: record ${ index } ${ message }`, null, parseGitLsTree);
}
