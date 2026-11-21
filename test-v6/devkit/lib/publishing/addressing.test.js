import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import {
    FORMAT,
    canonicalize,
    getBlobSize,
    hashBlob,
} from '../../../lib/publishing/addressing.js';


/*
 * These vectors are unchanged from format 3: format 4 reset the storage
 * namespace and left the digest alone. A format bump that does change one of
 * them changes every object id this tool computes, and must be treated as a
 * migration rather than a constant edit.
 *
 * Regenerate these vectors from the project root with the upstream module
 * (test/conformance/addressing.test.js also compares the two):
 *
 * node --input-type=module -e "import { canonicalize, hashBlob } from
 * './lib/kixx/content-addressable-store/addressing.js'; ..."
 *
 * Pass the literal inputs below to the matching hash export. Canonicalize the
 * nested object and array before hashing them as string blobs.
 */
const STRING_VECTORS = [
    [ '', 'ny2axhh7wn5jrhffittlw6akfq', 0 ],
    [ 'hello', 'rivfzg3wrat54wuvklbyubcmmy', 5 ],
    [ 'héllo 🌍', '7gw2xubdiru7bj6ijnvcnnjd2i', 11 ],
    [
        canonicalize({ z: { b: 2, a: 1 }, a: 'first' }),
        'tyhpoevqj3r4hai272mxduymtu',
        31,
    ],
    [
        canonicalize([ 'alpha', { z: false, a: null }, 3 ]),
        'lpzhyok4zrloz7tlncxt6rajbe',
        32,
    ],
];


describe('publishing/addressing', ({ it }) => {
    it('pins the framework format', () => {
        assertEqual(4, FORMAT);
    });

    it('sorts object keys recursively and omits undefined properties', () => {
        const value = {
            z: { y: undefined, b: 2, a: 1 },
            omitted: undefined,
            a: 'first',
        };

        assertEqual('{"a":"first","z":{"a":1,"b":2}}', canonicalize(value));
    });

    it('preserves array order', () => {
        assertEqual('[3,{"a":1,"b":2},1]', canonicalize([ 3, { b: 2, a: 1 }, 1 ]));
    });

    it('serializes Date objects as empty objects', () => {
        assertEqual('{}', canonicalize(new Date('2026-08-31T00:00:00.000Z')));
    });

    it('rejects non-finite numbers and unsupported types', () => {
        for (const value of [ NaN, Infinity, -Infinity, undefined, 1n, Symbol('x'), () => null ]) {
            const caught = catchError(() => canonicalize(value));

            assert(caught, `expected ${ String(value) } to throw`);
            assertEqual('TypeError', caught.name);
        }
    });

    it('matches upstream string blob digests and UTF-8 sizes', () => {
        for (const [ value, expectedHash, expectedSize ] of STRING_VECTORS) {
            assertEqual(expectedHash, hashBlob(value));
            assertEqual(expectedSize, getBlobSize(value));
            assertMatches(/^[a-z2-7]{26}$/, hashBlob(value));
        }
    });

    it('matches the upstream binary blob digest and size', () => {
        const bytes = Uint8Array.from([ 0, 1, 2, 127, 128, 255 ]).buffer;

        assertEqual('fxjwehnnbukzorm5dlx5tsgd7a', hashBlob(bytes));
        assertEqual(6, getBlobSize(bytes));
    });

    it('gives text and its UTF-8 bytes the same address', () => {
        const string = 'hello';
        const bytes = new TextEncoder().encode(string).buffer;

        assertEqual(hashBlob(string), hashBlob(bytes));
    });

    it('rejects values that are not publishable blobs', () => {
        const hashError = catchError(() => hashBlob(new Uint8Array()));
        const sizeError = catchError(() => getBlobSize(new Uint8Array()));

        assertEqual('TypeError', hashError.name);
        assertEqual('TypeError', sizeError.name);
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
