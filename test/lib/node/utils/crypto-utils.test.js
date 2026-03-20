import { describe } from 'kixx-test';
import { assertEqual, assertNonEmptyString } from 'kixx-assert';
import { computeSHA256 } from '../../../../lib/node/utils/mod.js';


const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

describe('NodeUtils#computeSHA256() when called with a string', ({ before, it }) => {
    let result;

    before(async () => {
        result = await computeSHA256('hello world');
    });

    it('returns a lowercase hex string of 64 characters', () => {
        assertNonEmptyString(result);
        assertEqual(true, SHA256_HEX_PATTERN.test(result));
    });

    it('returns the correct SHA-256 digest', () => {
        // Known SHA-256 of "hello world" (UTF-8)
        assertEqual('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9', result);
    });

    it('returns the same digest for the same input', async () => {
        assertEqual(result, await computeSHA256('hello world'));
    });
});

describe('NodeUtils#computeSHA256() when called with an ArrayBuffer', ({ before, it }) => {
    let stringResult;
    let bufferResult;

    before(async () => {
        // UTF-8 encode "hello world" manually to verify string and buffer produce the same digest
        const encoded = new TextEncoder().encode('hello world');
        stringResult = await computeSHA256('hello world');
        bufferResult = await computeSHA256(encoded.buffer);
    });

    it('returns the same digest as the equivalent UTF-8 encoded string', () => {
        assertEqual(stringResult, bufferResult);
    });
});

describe('NodeUtils#computeSHA256() when called with different inputs', ({ before, it }) => {
    let result1;
    let result2;

    before(async () => {
        result1 = await computeSHA256('foo');
        result2 = await computeSHA256('bar');
    });

    it('returns different digests for different inputs', () => {
        assertEqual(true, result1 !== result2);
    });
});
