import { isUndefined } from '../assertions/mod.js';


/**
 * Compares strings in UTF-16 code-unit order.
 * @param {string} a - Left operand
 * @param {string} b - Right operand
 * @returns {number} Negative, zero or positive when a sorts before, with or after b
 */
export function compareStrings(a, b) {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

/**
 * Serializes a JSON-compatible value deterministically, sorting object keys,
 * omitting undefined object properties and removing insignificant whitespace.
 *
 * This is a published wire-format primitive. Publishing clients outside this
 * repository reproduce these exact bytes to compute an `x-checksum`, so any
 * two callers that canonicalize the same logical value must produce
 * byte-identical output. Object keys sort by UTF-16 code unit; object
 * properties whose value is `undefined` are omitted; arrays preserve order;
 * output has no insignificant whitespace; numbers use `JSON.stringify()`
 * formatting; and non-finite numbers are rejected.
 *
 * @param {null|boolean|number|string|Array<*>|Object} value - Value to serialize
 * @returns {string} Deterministic JSON representation
 * @throws {TypeError} When value contains a non-finite number or unsupported type
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
