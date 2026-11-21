import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import * as devkit from '../../lib/publishing/addressing.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit
// computes exactly the object ids the server computes.
import * as lib from '../../../lib/kixx/content-addressable-store/addressing.js';


const TEXT_INPUTS = [
    '',
    'hello',
    'héllo 🌍 — ünïcödé',
    'line one\r\nline two\n',
    '\u0000￿',
];

const JSON_INPUTS = [
    null,
    true,
    0,
    -1.5,
    'text',
    [],
    {},
    { z: { b: 2, a: 1 }, a: 'first', skipped: undefined },
    [ 'alpha', { z: false, a: null }, 3 ],
    { 'é': 1, 'e': 2, 'E': 3, 'é́': 4 },
];

const BINARY_INPUTS = [
    new Uint8Array(0),
    Uint8Array.from([ 0, 1, 2, 255 ]),
    Uint8Array.from({ length: 4096 }, (_, index) => (index * 31) % 256),
];


describe('conformance: publishing addressing matches lib', ({ it }) => {

    it('uses the same FORMAT', () => {
        assertEqual(lib.FORMAT, devkit.FORMAT);
    });

    it('hashes text blobs identically', async () => {
        for (const text of TEXT_INPUTS) {
            // eslint-disable-next-line no-await-in-loop
            assertEqual(await lib.hashBlob(text), devkit.hashBlob(text), JSON.stringify(text));
        }
    });

    it('hashes binary blobs identically', async () => {
        for (const bytes of BINARY_INPUTS) {
            const buffer = bytes.slice().buffer;
            // eslint-disable-next-line no-await-in-loop
            assertEqual(await lib.hashBlob(buffer), devkit.hashBlob(buffer), `${ bytes.length } bytes`);
        }
    });

    it('addresses text and its UTF-8 bytes identically', async () => {
        const buffer = new TextEncoder().encode('héllo').buffer;

        assertEqual(await lib.hashBlob('héllo'), devkit.hashBlob(buffer));
    });

    it('canonicalizes JSON identically, and hashes the result identically', async () => {
        for (const value of JSON_INPUTS) {
            const canonical = devkit.canonicalize(value);

            assertEqual(lib.canonicalize(value), canonical, JSON.stringify(value));
            // eslint-disable-next-line no-await-in-loop
            assertEqual(await lib.hashBlob(canonical), devkit.hashBlob(canonical));
        }
    });

    it('orders strings identically', () => {
        const values = [ 'b', 'a', 'B', 'é', 'é', '', 'aa', '🌍', '￿' ];

        const libOrder = [ ...values ].sort(lib.compareStrings).join('|');
        const devkitOrder = [ ...values ].sort(devkit.compareStrings).join('|');

        assertEqual(libOrder, devkitOrder);
    });
});
