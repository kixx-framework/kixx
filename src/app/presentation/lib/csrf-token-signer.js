import { assertNonEmptyString, isNonEmptyString, isObjectNotNull } from '../../../kixx/assertions/mod.js';
import { bytesToBase64Url, base64UrlToBytes } from '../../../kixx/utils/base64url.js';


/**
 * Mints and verifies stateless CSRF tokens as an HMAC-SHA-256 envelope over a
 * `{sid, exp}` payload, so the signature itself carries the state a
 * synchronizer-token pattern would otherwise store server-side.
 *
 * Token format: `base64url(payloadBytes) "." base64url(signatureBytes)`, where
 * `payloadBytes` is the UTF-8 JSON encoding of `{sid, exp}` and `exp` is a
 * whole Unix seconds timestamp. This mirrors `DocumentStore#sealCursor()`
 * (`src/kixx/document-store/document-store.js`), the existing precedent in
 * this codebase for a signed stateless value.
 *
 * @see DocumentStore in ../../../kixx/document-store/document-store.js for the analogous cursor-signing pattern
 */
export default class CsrfTokenSigner {

    #keyPromise;

    /**
     * @param {string} secret - Non-empty deploy-time signing secret.
     * @throws {AssertionError} When secret is not a non-empty string.
     */
    constructor(secret) {
        assertNonEmptyString(secret, 'CsrfTokenSigner() requires a non-empty secret');

        // Store the imported CryptoKey promise, not the raw secret, and import
        // it once for the life of this instance. Workers isolates persist
        // instance state across requests, so this amortizes to zero cost.
        this.#keyPromise = crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            [ 'sign', 'verify' ],
        );
    }

    /**
     * Mints a token binding `sid` to an expiration `ttlSeconds` in the future.
     * @param {string} sid - Pre-session id to bind the token to.
     * @param {number} ttlSeconds - Seconds until the token expires.
     * @returns {Promise<string>} Two-segment base64url token.
     */
    async sign(sid, ttlSeconds) {
        const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
        const payload = new TextEncoder().encode(JSON.stringify({ sid, exp }));
        const key = await this.#keyPromise;
        const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));

        return `${ bytesToBase64Url(payload) }.${ bytesToBase64Url(signature) }`;
    }

    /**
     * Verifies a token against the `sid` it must be bound to.
     *
     * Fails closed and uniformly: a malformed, forged, expired, or
     * `sid`-mismatched token returns `false` without ever throwing or
     * distinguishing which check failed, so no caller can build a
     * distinguishing oracle out of the failure mode. Malformed input is an
     * expected condition here, not a programmer error.
     *
     * @param {string} token - Token previously returned by `sign()`.
     * @param {string} sid - Expected pre-session id.
     * @returns {Promise<boolean>} `true` when the token is valid and bound to `sid`.
     */
    async verify(token, sid) {
        const segments = isNonEmptyString(token) ? token.split('.') : [];
        if (segments.length !== 2 || !segments[0] || !segments[1]) {
            return false;
        }

        const [ encodedPayload, encodedSignature ] = segments;

        let payload;
        let signature;
        try {
            payload = base64UrlToBytes(encodedPayload);
            signature = base64UrlToBytes(encodedSignature);
        } catch {
            return false;
        }

        const key = await this.#keyPromise;
        const isValidSignature = await crypto.subtle.verify('HMAC', key, signature, payload);
        if (!isValidSignature) {
            return false;
        }

        let envelope;
        try {
            envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
        } catch {
            return false;
        }

        if (!isObjectNotNull(envelope)
            || !isNonEmptyString(envelope.sid)
            || !Number.isInteger(envelope.exp)) {
            return false;
        }

        if (envelope.exp <= Math.floor(Date.now() / 1000)) {
            return false;
        }

        return envelope.sid === sid;
    }
}
