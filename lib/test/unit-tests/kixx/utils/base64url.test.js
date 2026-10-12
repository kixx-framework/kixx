import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import { bytesToBase64Url, base64UrlToBytes } from '../../../../src/kixx/utils/base64url.js';


describe('base64url', ({ describe }) => {

    describe('round trip', ({ it }) => {

        it('round-trips arbitrary bytes', () => {
            const bytes = new Uint8Array([ 0, 1, 2, 254, 255, 128, 42 ]);
            const encoded = bytesToBase64Url(bytes);
            const decoded = base64UrlToBytes(encoded);

            assertEqual(Array.from(bytes).join(','), Array.from(decoded).join(','));
        });

        it('encodes empty input to an empty string', () => {
            // base64UrlToBytes() does not accept this value back: its alphabet
            // pattern requires one or more characters, so an empty payload has
            // no round trip. That is pre-existing behavior carried over
            // unchanged from document-store.js, not introduced here.
            assertEqual('', bytesToBase64Url(new Uint8Array([])));
        });

        it('round-trips bytes that encode with padding', () => {
            // 5 bytes base64-encodes to a length requiring "=" padding, exercising
            // the padEnd()/replace(/=+$/) padding-restoration path.
            const bytes = new Uint8Array([ 10, 20, 30, 40, 50 ]);
            const encoded = bytesToBase64Url(bytes);
            const decoded = base64UrlToBytes(encoded);

            assertEqual(Array.from(bytes).join(','), Array.from(decoded).join(','));
        });
    });

    describe('bytesToBase64Url()', ({ it }) => {

        it('produces URL-safe output with no "+", "/", or trailing "="', () => {
            // Bytes chosen so the standard base64 alphabet would emit both "+"
            // and "/" and require padding, if not translated to base64url.
            const bytes = new Uint8Array([ 251, 255, 191, 239, 190 ]);
            const encoded = bytesToBase64Url(bytes);

            assertFalsy(encoded.includes('+'));
            assertFalsy(encoded.includes('/'));
            assertFalsy(encoded.endsWith('='));
        });
    });

    describe('base64UrlToBytes()', ({ it }) => {

        it('rejects characters outside the base64url alphabet', () => {
            const caught = catchError(() => base64UrlToBytes('not+valid/base64url'));

            assert(caught);
            assertEqual('Invalid base64url value', caught.message);
        });

        it('rejects a non-canonical encoding a permissive atob() would accept', () => {
            // A single zero byte canonically encodes to "AA": the second
            // character's low 4 bits are unused padding, always zero in
            // canonical form. "AB" decodes those unused bits differently
            // ('B' vs 'A') while producing the identical byte (0x00), so a
            // permissive atob() accepts it, but re-encoding the decoded byte
            // yields "AA", not "AB" — the canonical-form mismatch this check
            // exists to catch.
            assertEqual('AA', bytesToBase64Url(new Uint8Array([ 0 ])));

            const caught = catchError(() => base64UrlToBytes('AB'));

            assert(caught);
            assertEqual('Invalid base64url value', caught.message);
        });
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
