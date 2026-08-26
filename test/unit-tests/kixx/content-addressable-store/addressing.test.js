import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual } from 'kixx-assert';

import {
    FORMAT,
    KEY,
    stringToUint8Array,
    bufferToString,
    hashArrayBufferBlob,
    hashStringBlob,
    hashTree,
    hashSet,
    hashString,
    isValidHash,
    canonicalize,
    compareStrings,
} from '../../../../src/kixx/content-addressable-store/addressing.js';

// Digests are SHA-256 truncated to 16 bytes, so base32 (5 bits per character)
// needs ceil(128 / 5) = 26 characters and no padding.
const DIGEST_PATTERN = /^[a-z2-7]{26}$/;

function toArrayBuffer(value) {
    return stringToUint8Array(value).buffer;
}

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
            assertEqual(2, FORMAT);
        });

        it('prefixes blob storage keys with the format version', () => {
            assertEqual('b:2:', KEY.blob);
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

    describe('isValidHash()', ({ it }) => {
        it('accepts a well-formed content digest', () => {
            assertEqual(true, isValidHash('ny2axhh7wn5jrhffittlw6akfq'));
        });

        it('rejects malformed values', () => {
            for (const value of [ '', '.', '..', 'a/b', 'a\\b', 'a\u0000b' ]) {
                assertEqual(false, isValidHash(value));
            }
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

    describe('content hashing', ({ describe }) => {

        describe('hashArrayBufferBlob()', ({ it }) => {
            it('matches a known digest for the empty blob', async () => {
                assertEqual('ny2axhh7wn5jrhffittlw6akfq', await hashArrayBufferBlob(new ArrayBuffer(0)));
            });

            it('matches a known digest for a non-empty blob', async () => {
                assertEqual('rivfzg3wrat54wuvklbyubcmmy', await hashArrayBufferBlob(toArrayBuffer('hello')));
            });

            it('is deterministic for identical bytes', async () => {
                const bytes = toArrayBuffer('same content');
                assertEqual(await hashArrayBufferBlob(bytes), await hashArrayBufferBlob(bytes));
            });

            it('produces different digests for different bytes', async () => {
                const a = await hashArrayBufferBlob(toArrayBuffer('one'));
                const b = await hashArrayBufferBlob(toArrayBuffer('two'));
                assertNotEqual(a, b);
            });

            it('returns lowercase unpadded base32 text', async () => {
                const digest = await hashArrayBufferBlob(toArrayBuffer('anything'));
                assertMatches(DIGEST_PATTERN, digest);
            });

            it('rejects a value that is not an ArrayBuffer', async () => {
                const caught = await catchAsyncError(() => hashArrayBufferBlob('hello'));

                assert(caught, 'expected an error to be thrown');
                assertEqual('TypeError', caught.name);
                assertMatches('not an ArrayBuffer', caught.message);
            });
        });

        describe('hashStringBlob()', ({ it }) => {
            it('matches a known digest for the empty blob', async () => {
                assertEqual('jp2relzuivkmko66f25yzuvx4m', await hashStringBlob(''));
            });

            it('matches a known digest for a non-empty blob', async () => {
                assertEqual('ztxlpkmf5tb5vpfuzd3gntldp4', await hashStringBlob('hello'));
            });

            it('returns lowercase unpadded base32 text', async () => {
                assertMatches(DIGEST_PATTERN, await hashStringBlob('anything'));
            });

            it('rejects a value that is not a string', async () => {
                const caught = await catchAsyncError(() => hashStringBlob(toArrayBuffer('hello')));

                assert(caught, 'expected an error to be thrown');
                assertEqual('TypeError', caught.name);
                assertMatches('must be a string', caught.message);
            });
        });

        describe('hashTree()', ({ it }) => {
            it('matches a known digest', async () => {
                assertEqual('bunlyzwhljkwbjatqkjig6bd6y', await hashTree({ a: 1 }));
            });

            it('canonicalizes before hashing, so key order does not matter', async () => {
                const a = await hashTree({ a: 1, b: 2 });
                const b = await hashTree({ b: 2, a: 1 });
                assertEqual(a, b);
            });
        });

        describe('hashSet()', ({ it }) => {
            it('matches a known digest', async () => {
                assertEqual('muajbujkcmpjobtg22bjiwjrby', await hashSet([ 1, 2, 3 ]));
            });
        });

        describe('hashString()', ({ it }) => {
            it('matches a known digest', async () => {
                assertEqual('ak7wqhjqmk4rb2vt4zow3ahwou', await hashString('hello'));
            });

            it('is deterministic for identical text', async () => {
                assertEqual(await hashString('same'), await hashString('same'));
            });

            it('produces different digests for different text', async () => {
                assertNotEqual(await hashString('one'), await hashString('two'));
            });

            it('rejects a value that is not a string', async () => {
                const caught = await catchAsyncError(() => hashString(42));

                assert(caught, 'expected an error to be thrown');
                assertEqual('TypeError', caught.name);
                assertMatches('must be a string', caught.message);
            });
        });

        describe('domain separation', ({ it }) => {
            it('hashes the same canonical bytes differently across content domains', async () => {
                // Every one of these hashes the bytes of "[1,2,3]" -- only the
                // domain byte prepended to the digest input differs, so equal
                // digests here would mean a blob could be mistaken for the tree
                // or set whose canonical form it happens to match.
                const canonical = '[1,2,3]';

                const digests = new Set([
                    await hashArrayBufferBlob(toArrayBuffer(canonical)),
                    await hashStringBlob(canonical),
                    await hashTree([ 1, 2, 3 ]),
                    await hashSet([ 1, 2, 3 ]),
                    await hashString(canonical),
                ]);

                assertEqual(5, digests.size);
            });
        });
    });
});
