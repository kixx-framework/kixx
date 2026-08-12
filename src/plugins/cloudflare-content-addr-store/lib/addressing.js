import {
    isUndefined,
} from '../../kixx/assertions/mod.js';

/**
 * Wire format v1:
 *   - digest:   SHA-256 truncated to 128 bits, base32 (RFC 4648 lowercase, no pad)
 *   - domains:  blobs, trees and digest-sets are hashed under distinct prefix
 *               bytes so a blob can never collide with a tree that happens to
 *               serialize to the same bytes
 *   - keys:     two-char format prefix so a future format can coexist
 */

export const FORMAT = 1;

export const KEY = {
    blob: `b${FORMAT}:`,
    tree: `t${FORMAT}:`,
    index: `i${FORMAT}:`,
    closure: `c${FORMAT}:`,
    roots: `r${FORMAT}:recent`,
};

/** SHA-256 truncated to 128 bits; ~1e-21 collision probability at 1e9 objects. */
const DIGEST_BYTES = 16;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const DOMAIN_BLOB = 0x00;
const DOMAIN_TREE = 0x01;
const DOMAIN_SET = 0x02;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function stringToBuff(str) {
    return encoder.encode(str);
}

export function buffToString(bytes) {
    return decoder.decode(bytes);
}

/**
 * Single ordering comparator used for tree entries, index keys and digest sets.
 * Which order it produces matters far less than that both the read and write
 * sides of the ContentAddressableStore always use this one. UTF-16 code-unit
 * order (the JS default) is fine as long as it is applied consistently.
 */
function compareStrings(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

/**
 * RFC 4648 base32, lowercase, unpadded. Chosen over base64url because these
 * strings travel through URLs and case-insensitive intermediaries.
 */
export function base32Encode(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        value = ((value << 8) | bytes[i]) >>> 0;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += BASE32[(value >>> bits) & 31];
        }
        // Drop consumed high bits so `value` can never overflow 32 bits.
        value = bits === 0 ? 0 : value & ((1 << bits) - 1);
    }

    if (bits > 0) {
        out += BASE32[(value << (5 - bits)) & 31];
    }

    return out;
}

async function digestDomain(domain, payload) {
    const buf = new Uint8Array(1 + payload.length);
    buf[0] = domain;
    buf.set(payload, 1);

    const digest = await crypto.subtle.digest('SHA-256', buf);
    const full = new Uint8Array(digest);
    return base32Encode(full.subarray(0, DIGEST_BYTES));
}

export async function hashSet(obj) {
    return await digestDomain(DOMAIN_SET, stringToBuff(canonicalize(obj)));
}

export async function hashBlob(bytes) {
    return await digestDomain(DOMAIN_BLOB, bytes);
}

export async function hashTree(obj) {
    return await digestDomain(DOMAIN_TREE, stringToBuff(canonicalize(obj)));
}

/**
 * Deterministic JSON. Sorted keys, no insignificant whitespace, `undefined`
 * dropped, non-finite numbers rejected.
 *
 * This function is critical to the ContentAddressableStore: if two runs of the
 * publisher serialize the same logical tree differently, the root hash changes
 * when nothing changed, and every downstream cache misses;
 * Do not "optimize" it into JSON.stringify.
 */
export function canonicalize(value) {
    if (value === null) {
        return 'null';
    }

    const t = typeof value;
    if (t === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`canonicalize: non-finite number ${ value }`);
        }
        return JSON.stringify(value);
    }
    if (t === 'string' || t === 'boolean') {
        return JSON.stringify(value);
    }
    if (t !== 'object') {
        throw new TypeError(`canonicalize: unsupported type ${ t }`);
    }
    if (Array.isArray(value)) {
        return `[${ value.map(canonicalize).join(',') }]`;
    }

    const keys = Object.keys(value)
        .filter((k) => !isUndefined(value[k]))
        .sort(compareStrings);

    const parts = keys.map((k) => {
        return `${ JSON.stringify(k) }:${ canonicalize(value[k]) }`;
    });

    return `{${ parts.join(',') }}`;
}

export async function digestMap(pairs) {
    // Sort by key before hashing so the result is independent of the order
    // callers supplied inputs in — digest(['a','b']) === digest(['b','a']).
    const sorted = [...pairs.entries()].sort((a, b) => compareStrings(a[0], b[0]));
    return await hashSet(sorted);
}
