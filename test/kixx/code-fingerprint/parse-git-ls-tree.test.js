import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { ValidationError } from '../../../kixx/errors/mod.js';
import { parseGitLsTree } from '../../../kixx/code-fingerprint/mod.js';


const BLOB = 'ce013625030ba8dba906f756967f9e9ca394464a';
const LINK = '0123456789abcdef0123456789abcdef01234567';
const SHA256_BLOB = '2cf8d83d9ee29543b34a87727421fdecb7e3f3a183d337639025de576db9ebb4';

const LISTING = `100644 blob ${ BLOB }\tapp/app.js\0`
    + `100755 blob ${ BLOB }\tbin/run sh\0`
    + `120000 blob ${ BLOB }\tcurrent\0`
    + `160000 commit ${ LINK }\tvendor/lib\0`
    + `100644 blob ${ BLOB }\tapp/été\t.js\0`;

const EXPECTED = [
    { path: 'app/app.js', mode: '100644', oid: BLOB },
    { path: 'bin/run sh', mode: '100755', oid: BLOB },
    { path: 'current', mode: '120000', oid: BLOB },
    { path: 'vendor/lib', mode: '160000', oid: LINK },
    { path: 'app/été\t.js', mode: '100644', oid: BLOB },
];


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertRefused(output, expectedIndex) {
    const error = catchError(() => parseGitLsTree(output));
    assert(error instanceof ValidationError, 'expected a ValidationError');
    assert(error.message.includes(`record ${ expectedIndex }`), error.message);
}


describe('parseGitLsTree', ({ it }) => {

    it('parses a string listing', () => {
        assertEqual(JSON.stringify(EXPECTED), JSON.stringify(parseGitLsTree(LISTING)));
    });

    it('parses bytes as a Uint8Array and as an ArrayBuffer', () => {
        const bytes = new TextEncoder().encode(LISTING);

        assertEqual(JSON.stringify(EXPECTED), JSON.stringify(parseGitLsTree(bytes)));
        assertEqual(JSON.stringify(EXPECTED), JSON.stringify(parseGitLsTree(bytes.slice().buffer)));
    });

    it('accepts SHA-256 object ids', () => {
        const entries = parseGitLsTree(`100644 blob ${ SHA256_BLOB }\ta.js\0`);
        assertEqual(SHA256_BLOB, entries[0].oid);
    });

    it('accepts a listing without the final NUL', () => {
        assertEqual(1, parseGitLsTree(`100644 blob ${ BLOB }\ta.js`).length);
    });

    it('returns no entries for an empty listing', () => {
        assertEqual(0, parseGitLsTree('').length);
        assertEqual(0, parseGitLsTree(new Uint8Array(0)).length);
    });

    it('refuses a bad mode', () => {
        assertRefused(`100644 blob ${ BLOB }\ta.js\x00100664 blob ${ BLOB }\tb.js\0`, 1);
    });

    it('refuses a tree record', () => {
        assertRefused(`040000 tree ${ BLOB }\tapp\0`, 0);
    });

    it('refuses a type that does not fit the mode', () => {
        assertRefused(`160000 blob ${ BLOB }\tvendor/lib\0`, 0);
        assertRefused(`100644 commit ${ BLOB }\ta.js\0`, 0);
    });

    it('refuses a bad oid', () => {
        assertRefused(`100644 blob ${ BLOB.toUpperCase() }\ta.js\0`, 0);
        assertRefused(`100644 blob ${ BLOB.slice(1) }\ta.js\0`, 0);
    });

    it('refuses a record with no tab', () => {
        assertRefused(`100644 blob ${ BLOB } a.js\0`, 0);
    });

    it('refuses an empty record', () => {
        assertRefused(`100644 blob ${ BLOB }\ta.js\0\0`, 1);
    });

    it('refuses a path that is not UTF-8', () => {
        const head = new TextEncoder().encode(`100644 blob ${ BLOB }\ta`);
        const bytes = new Uint8Array(head.length + 2);
        bytes.set(head);
        bytes.set([ 0xff, 0 ], head.length);

        assertRefused(bytes, 0);
    });

    it('refuses output that is not bytes or a string', () => {
        assert(catchError(() => parseGitLsTree(42)) instanceof ValidationError);
    });
});
