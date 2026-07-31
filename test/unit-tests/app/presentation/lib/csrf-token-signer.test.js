import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import CsrfTokenSigner from '../../../../../src/app/presentation/lib/csrf-token-signer.js';
import { bytesToBase64Url, base64UrlToBytes } from '../../../../../src/kixx/utils/base64url.js';


const TEST_SECRET = 'csrf-token-signer-test-signing-secret';


describe('CsrfTokenSigner', ({ describe }) => {

    describe('sign()', ({ it }) => {

        it('produces two "."-separated base64url segments decoding to {sid, exp}', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const before = Math.floor(Date.now() / 1000);
            const token = await signer.sign('sid-1', 1800);
            const after = Math.floor(Date.now() / 1000);

            const segments = token.split('.');
            assertEqual(2, segments.length);
            assert(segments[0].length > 0);
            assert(segments[1].length > 0);

            const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segments[0])));
            assertEqual('sid-1', payload.sid);
            assert(payload.exp >= before + 1800);
            assert(payload.exp <= after + 1800);
            assertEqual(true, Number.isInteger(payload.exp));
        });

        it('imports the CryptoKey at most once across many sign()/verify() calls', async () => {
            const tracker = new MockTracker();
            const importKey = tracker.method(crypto.subtle, 'importKey');

            const signer = new CsrfTokenSigner(TEST_SECRET);
            const tokenA = await signer.sign('sid-1', 1800);
            const tokenB = await signer.sign('sid-1', 1800);
            await signer.verify(tokenA, 'sid-1');
            await signer.verify(tokenB, 'sid-1');

            const callCount = importKey.mock.callCount();
            tracker.reset();

            assertEqual(1, callCount);
        });
    });

    describe('verify()', ({ it }) => {

        it('accepts a token verified against the sid it was minted for', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const token = await signer.sign('sid-1', 1800);

            assertEqual(true, await signer.verify(token, 'sid-1'));
        });

        it('verifies against a second instance constructed with the same secret', async () => {
            const signerA = new CsrfTokenSigner(TEST_SECRET);
            const signerB = new CsrfTokenSigner(TEST_SECRET);
            const token = await signerA.sign('sid-1', 1800);

            assertEqual(true, await signerB.verify(token, 'sid-1'));
        });

        it('rejects a token verified against a signer built with a different secret', async () => {
            const signerA = new CsrfTokenSigner(TEST_SECRET);
            const signerB = new CsrfTokenSigner('a-different-signing-secret');
            const token = await signerA.sign('sid-1', 1800);

            assertEqual(false, await signerB.verify(token, 'sid-1'));
        });

        it('rejects a token with the wrong segment count', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);

            assertEqual(false, await signer.verify('only-one-segment', 'sid-1'));
        });

        it('rejects non-canonical base64url', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const token = await signer.sign('sid-1', 1800);
            const [ payload ] = token.split('.');

            assertEqual(false, await signer.verify(`${ payload }.not+valid/base64url`, 'sid-1'));
        });

        it('rejects a bad signature', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const token = await signer.sign('sid-1', 1800);
            const [ payload, signature ] = token.split('.');
            const tamperedSignature = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

            assertEqual(false, await signer.verify(`${ payload }.${ tamperedSignature }`, 'sid-1'));
        });

        it('rejects a non-UTF-8, non-JSON payload', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);

            // Sign arbitrary garbage bytes as the "payload" through a second
            // signer sharing the same secret, so the signature validates but
            // the payload fails to parse as JSON.
            const garbagePayload = 'not-json-at-all';
            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(TEST_SECRET),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                [ 'sign' ],
            );
            const payloadBytes = new TextEncoder().encode(garbagePayload);
            const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes));
            const token = `${ bytesToBase64Url(payloadBytes) }.${ bytesToBase64Url(signatureBytes) }`;

            assertEqual(false, await signer.verify(token, 'sid-1'));
        });

        it('rejects a malformed sid or exp shape', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);

            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(TEST_SECRET),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                [ 'sign' ],
            );

            async function signPayload(payloadObject) {
                const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObject));
                const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes));
                return `${ bytesToBase64Url(payloadBytes) }.${ bytesToBase64Url(signatureBytes) }`;
            }

            const missingSid = await signPayload({ exp: Math.floor(Date.now() / 1000) + 1800 });
            const nonStringExp = await signPayload({ sid: 'sid-1', exp: 'not-a-number' });

            assertEqual(false, await signer.verify(missingSid, 'sid-1'));
            assertEqual(false, await signer.verify(nonStringExp, 'sid-1'));
        });

        it('rejects an expired token', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const token = await signer.sign('sid-1', 0);

            // exp is whole Unix seconds and the check is exp > now, so a
            // zero-second TTL token is already expired by the time it is
            // verified, without needing to mock the clock.
            assertEqual(false, await signer.verify(token, 'sid-1'));
        });

        it('rejects a token bound to a different sid', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);
            const token = await signer.sign('sid-1', 1800);

            assertEqual(false, await signer.verify(token, 'sid-2'));
        });

        it('rejects falsy or non-string tokens without throwing', async () => {
            const signer = new CsrfTokenSigner(TEST_SECRET);

            assertFalsy(await signer.verify('', 'sid-1'));
            assertFalsy(await signer.verify(null, 'sid-1'));
        });
    });
});
