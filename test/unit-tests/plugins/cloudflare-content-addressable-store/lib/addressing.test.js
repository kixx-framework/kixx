import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual } from 'kixx-assert';

import {
    FORMAT,
    KEY,
    stringToUint8Array,
    bufferToString,
    isValidPathname,
    normalizePathname,
    typedArrayToBuffer,
    compareStrings,
    canonicalize,
    hashBlob,
    hashTree,
    hashSet,
    hashValue,
} from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


// Digests are SHA-256 truncated to 16 bytes, so base32 (5 bits per character)
// needs ceil(128 / 5) = 26 characters and no padding.
const DIGEST_PATTERN = /^[a-z2-7]{26}$/;

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('addressing', ({ describe }) => {

    describe('FORMAT and KEY', ({ it }) => {
        it('exposes the current wire format version', () => {
            assertEqual(1, FORMAT);
        });

        it('prefixes blob storage keys with the format version', () => {
            assertEqual('b:1:', KEY.blob);
        });
    });

    describe('stringToUint8Array() and bufferToString()', ({ it }) => {
        it('round-trips ASCII text', () => {
            const bytes = stringToUint8Array('hello world');
            assertEqual('hello world', bufferToString(bytes));
        });

        it('round-trips multi-byte UTF-8 text', () => {
            const bytes = stringToUint8Array('héllo 世界');
            assertEqual('héllo 世界', bufferToString(bytes));
        });

        it('replaces malformed byte sequences instead of throwing', () => {
            const malformed = new Uint8Array([ 0xff, 0xfe, 0x41 ]);
            assertEqual('��A', bufferToString(malformed));
        });
    });

    describe('isValidPathname()', ({ it }) => {
        it('accepts a lowercase, slash-separated pathname', () => {
            assert(isValidPathname('/a/b/c-2.txt'));
        });

        it('accepts a pathname without a leading slash', () => {
            assert(isValidPathname('a/b'));
        });

        it('rejects non-string values', () => {
            assertEqual(false, isValidPathname(123));
            assertEqual(false, isValidPathname(null));
            assertEqual(false, isValidPathname(undefined));
        });

        it('rejects a pathname containing ".."', () => {
            assertEqual(false, isValidPathname('/a/../b'));
        });

        it('rejects a pathname containing doubled slashes', () => {
            assertEqual(false, isValidPathname('/a//b'));
        });

        it('rejects a pathname with uppercase characters', () => {
            assertEqual(false, isValidPathname('/A/b'));
        });

        it('rejects a segment starting with a dot', () => {
            assertEqual(false, isValidPathname('/.a/b'));
            assertEqual(false, isValidPathname('/a/.b'));
        });

        it('rejects characters outside the filename-safe set', () => {
            assertEqual(false, isValidPathname('/a b/c'));
            assertEqual(false, isValidPathname('/a!/c'));
        });
    });

    describe('normalizePathname()', ({ it }) => {
        it('lower-cases the pathname', () => {
            assertEqual('/a/b', normalizePathname('/A/B'));
        });

        it('adds a leading slash when one is missing', () => {
            assertEqual('/a/b', normalizePathname('a/b'));
        });

        it('collapses consecutive slashes', () => {
            assertEqual('/a/b', normalizePathname('//a///b//'));
        });

        it('removes a trailing slash', () => {
            assertEqual('/a/b', normalizePathname('/a/b/'));
        });

        it('throws TypeError when the value is not a string', () => {
            const caught = catchError(() => normalizePathname(123));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('An identifier must be a string', caught.message);
        });
    });

    describe('typedArrayToBuffer()', ({ it }) => {
        it('copies the full byte range of a whole-buffer view', () => {
            const typedArray = new Uint8Array([ 1, 2, 3, 4 ]);
            const buffer = typedArrayToBuffer(typedArray);

            assertEqual(4, buffer.byteLength);
            assertEqual('1,2,3,4', Array.from(new Uint8Array(buffer)).join(','));
        });

        it('copies only the viewed bytes of a subarray view', () => {
            const backing = new Uint8Array([ 9, 1, 2, 3, 9 ]);
            const view = backing.subarray(1, 4);
            const buffer = typedArrayToBuffer(view);

            assertEqual(3, buffer.byteLength);
            assertEqual('1,2,3', Array.from(new Uint8Array(buffer)).join(','));
        });

        it('does not alias the original buffer', () => {
            const typedArray = new Uint8Array([ 1, 2, 3 ]);
            const buffer = typedArrayToBuffer(typedArray);

            typedArray[0] = 99;

            assertEqual(1, new Uint8Array(buffer)[0]);
        });

        it('throws TypeError when the backing buffer is detached', () => {
            const arrayBuffer = new ArrayBuffer(4);
            const typedArray = new Uint8Array(arrayBuffer);
            arrayBuffer.transfer();

            const caught = catchError(() => typedArrayToBuffer(typedArray));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('compareStrings()', ({ it }) => {
        it('returns -1 when the left operand sorts first', () => {
            assertEqual(-1, compareStrings('a', 'b'));
        });

        it('returns 1 when the left operand sorts last', () => {
            assertEqual(1, compareStrings('b', 'a'));
        });

        it('returns 0 for equal strings', () => {
            assertEqual(0, compareStrings('a', 'a'));
        });
    });

    describe('canonicalize()', ({ it }) => {
        it('serializes null, booleans, and strings as JSON', () => {
            assertEqual('null', canonicalize(null));
            assertEqual('true', canonicalize(true));
            assertEqual('"a"', canonicalize('a'));
        });

        it('serializes finite numbers as JSON', () => {
            assertEqual('42', canonicalize(42));
            assertEqual('-1.5', canonicalize(-1.5));
        });

        it('throws TypeError for non-finite numbers', () => {
            const caught = catchError(() => canonicalize(NaN));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('non-finite number', caught.message);
        });

        it('throws TypeError for unsupported types', () => {
            const caught = catchError(() => canonicalize(undefined));

            assert(caught, 'expected an error to be thrown');
            assertEqual('TypeError', caught.name);
            assertMatches('unsupported type', caught.message);
        });

        it('serializes arrays by recursively canonicalizing each element', () => {
            assertEqual('[1,2,3]', canonicalize([ 1, 2, 3 ]));
        });

        it('sorts object keys regardless of insertion order', () => {
            assertEqual('{"a":2,"b":1}', canonicalize({ b: 1, a: 2 }));
        });

        it('omits object properties whose value is undefined', () => {
            assertEqual('{"b":1}', canonicalize({ a: undefined, b: 1 }));
        });

        it('canonicalizes nested structures depth-first', () => {
            assertEqual('[1,{"a":1,"b":2}]', canonicalize([ 1, { b: 2, a: 1 } ]));
        });

        it('produces identical output regardless of key insertion order', () => {
            assertEqual(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
        });
    });

    describe('content hashing', ({ describe }) => {

        describe('hashBlob()', ({ it }) => {
            it('matches a known digest for the empty blob', async () => {
                assertEqual('ny2axhh7wn5jrhffittlw6akfq', await hashBlob(new Uint8Array([])));
            });

            it('matches a known digest for a non-empty blob', async () => {
                assertEqual('rivfzg3wrat54wuvklbyubcmmy', await hashBlob(stringToUint8Array('hello')));
            });

            it('is deterministic for identical bytes', async () => {
                const bytes = stringToUint8Array('same content');
                assertEqual(await hashBlob(bytes), await hashBlob(bytes));
            });

            it('produces different digests for different bytes', async () => {
                const a = await hashBlob(stringToUint8Array('one'));
                const b = await hashBlob(stringToUint8Array('two'));
                assertNotEqual(a, b);
            });

            it('returns lowercase unpadded base32 text', async () => {
                const digest = await hashBlob(stringToUint8Array('anything'));
                assertMatches(DIGEST_PATTERN, digest);
            });
        });

        describe('hashTree()', ({ it }) => {
            it('matches a known digest', async () => {
                assertEqual('tifkrivlt573blgqpikckrcprm', await hashTree({ a: 1 }));
            });

            it('canonicalizes before hashing, so key order does not matter', async () => {
                const a = await hashTree({ a: 1, b: 2 });
                const b = await hashTree({ b: 2, a: 1 });
                assertEqual(a, b);
            });
        });

        describe('hashSet()', ({ it }) => {
            it('matches a known digest', async () => {
                assertEqual('af2czkyrgejqdw4m4z6ys2aiqm', await hashSet([ 1, 2, 3 ]));
            });
        });

        describe('hashValue()', ({ it }) => {
            it('matches a known undomained digest for a primitive string', async () => {
                assertEqual('lktwflryh65xe6xty6rw2skauu', await hashValue('hello'));
            });

            it('matches a known undomained digest for a primitive number', async () => {
                assertEqual('ondvznakk2hi3kfaixhnceatpy', await hashValue(42));
            });

            it('preserves the type distinction between numbers and strings', async () => {
                assertNotEqual(await hashValue(42), await hashValue('42'));
            });

            it('preserves the type distinction between booleans and strings', async () => {
                assertNotEqual(await hashValue(true), await hashValue('true'));
            });

            it('preserves the type distinction between null and strings', async () => {
                assertNotEqual(await hashValue(null), await hashValue('null'));
            });

            it('preserves the type distinction between undefined and strings', async () => {
                assertNotEqual(await hashValue(undefined), await hashValue('undefined'));
            });

            it('preserves the type distinction between numbers and bigints', async () => {
                assertNotEqual(await hashValue(42), await hashValue(42n));
            });

            it('canonicalizes non-primitive values before hashing', async () => {
                const a = await hashValue({ a: 1, b: 2 });
                const b = await hashValue({ b: 2, a: 1 });
                assertEqual(a, b);
            });

            it('rejects a non-primitive value that cannot be canonicalized', async () => {
                const caught = await catchAsyncError(() => hashValue(() => {}));

                assert(caught, 'expected an error to be thrown');
                assertEqual('TypeError', caught.name);
                assertMatches('unsupported type', caught.message);
            });
        });

        describe('domain separation', ({ it }) => {
            it('hashes the same canonical bytes differently across blob, tree, and set domains', async () => {
                const bytes = stringToUint8Array('[1,2,3]');

                const blobDigest = await hashBlob(bytes);
                const treeDigest = await hashTree([ 1, 2, 3 ]);
                const setDigest = await hashSet([ 1, 2, 3 ]);

                const digests = new Set([ blobDigest, treeDigest, setDigest ]);
                assertEqual(3, digests.size);
            });
        });
    });
});
