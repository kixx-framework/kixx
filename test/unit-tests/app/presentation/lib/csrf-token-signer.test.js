import { describe, MockTracker } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
} from 'kixx-assert';

import CsrfTokenSigner from '../../../../../src/app/presentation/lib/csrf-token-signer.js';
import {
    base64UrlToBytes,
    bytesToBase64Url,
} from '../../../../../src/kixx/utils/base64url.js';


const SECRET = 'unit-test-csrf-signing-secret';
const OTHER_SECRET = 'rotated-unit-test-csrf-signing-secret';
const SID = 'browser-csrf-session';
const NOW_MILLISECONDS = 2_000_000_000_000;


describe('CsrfTokenSigner', ({ it }) => {
    it('signs a token that verifies for its sid', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const token = await signer.sign(SID, 60);

        assertMatches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u, token);
        assertEqual(true, await signer.verify(token, SID));
    });

    it('embeds the sid and whole-second expiration in the signed payload', async () => {
        const tracker = new MockTracker();
        tracker.method(Date, 'now', () => NOW_MILLISECONDS);

        let envelope;
        try {
            const signer = new CsrfTokenSigner(SECRET);
            const token = await signer.sign(SID, 60);
            const [ encodedPayload ] = token.split('.');
            const json = new TextDecoder().decode(base64UrlToBytes(encodedPayload));
            envelope = JSON.parse(json);
        } finally {
            tracker.reset();
        }

        assertEqual(SID, envelope.sid);
        assertEqual(Math.floor(NOW_MILLISECONDS / 1000) + 60, envelope.exp);
    });

    it('allows a valid token to be verified more than once', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const token = await signer.sign(SID, 60);

        assertEqual(true, await signer.verify(token, SID));
        assertEqual(true, await signer.verify(token, SID));
    });

    it('rejects a token paired with a different sid', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const token = await signer.sign(SID, 60);

        assertFalsy(await signer.verify(token, 'different-browser-session'));
    });

    it('rejects a token after signing-secret rotation', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const rotatedSigner = new CsrfTokenSigner(OTHER_SECRET);
        const token = await signer.sign(SID, 60);

        assertFalsy(await rotatedSigner.verify(token, SID));
    });

    it('rejects a tampered signature', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const token = await signer.sign(SID, 60);
        const [ payload, signature ] = token.split('.');
        const firstCharacter = signature.startsWith('A') ? 'B' : 'A';
        const tampered = `${ payload }.${ firstCharacter }${ signature.slice(1) }`;

        assertFalsy(await signer.verify(tampered, SID));
    });

    it('rejects malformed token segments and base64url', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const malformedTokens = [
            '',
            'one-segment',
            'too.many.segments',
            '.signature',
            'payload.',
            'not+base64url.signature',
        ];

        for (const token of malformedTokens) {
            assertFalsy(await signer.verify(token, SID), `expected ${ token } to be rejected`);
        }
    });

    it('rejects signed payloads that are not valid envelopes', async () => {
        const signer = new CsrfTokenSigner(SECRET);
        const invalidJson = await signRawPayload(SECRET, 'not-json');
        const invalidShape = await signRawPayload(SECRET, JSON.stringify({ sid: SID, exp: 'later' }));

        assertFalsy(await signer.verify(invalidJson, SID));
        assertFalsy(await signer.verify(invalidShape, SID));
    });

    it('rejects an expired token at the exact expiration boundary', async () => {
        const tracker = new MockTracker();
        let now = NOW_MILLISECONDS;
        tracker.method(Date, 'now', () => now);

        let isValid;
        try {
            const signer = new CsrfTokenSigner(SECRET);
            const token = await signer.sign(SID, 60);
            now += 60_000;
            isValid = await signer.verify(token, SID);
        } finally {
            tracker.reset();
        }

        assertFalsy(isValid);
    });

    it('requires a non-empty signing secret', () => {
        const caught = catchError(() => new CsrfTokenSigner(''));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
    });
});


async function signRawPayload(secret, payloadText) {
    const payload = new TextEncoder().encode(payloadText);
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        [ 'sign' ],
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));

    return `${ bytesToBase64Url(payload) }.${ bytesToBase64Url(signature) }`;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
