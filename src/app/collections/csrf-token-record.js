import Record from './base-key-value-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { assert, isNonEmptyString, isValidDate } from '../../kixx/assertions/mod.js';
import { parseIsoDateTime } from '../lib/iso-date-time.js';


/**
 * Upper bound on live tokens held by one browser pre-session.
 *
 * Every form render mints a token into the record, so an unbounded list would let
 * a render loop grow a single key without limit. At the cap the oldest token is
 * evicted, which can break a form rendered many pages ago — acceptable, because
 * the alternative is an unbounded stored value, and the window is already capped
 * by the record's own expiration.
 * @type {number}
 */
const MAX_LIVE_TOKENS = 24;

/**
 * Minimum remaining lifetime for a pre-session to be worth writing to again.
 *
 * Two rules meet at this number. A form handed to a browser with seconds left to
 * live is broken on arrival, so reusing a nearly-dead pre-session for a fresh
 * render is not viable. And the key/value store contract rejects any expiry
 * less than 60 seconds out, so rewriting a pre-session below that floor
 * is not possible.
 *
 * @type {number}
 * @readonly
 */
export const MIN_REUSABLE_SECONDS = 120;


/**
 * Key/value-store DTO for one browser CSRF pre-session.
 *
 * The record holds a set of hashes rather than a single one because the cookie is
 * browser-wide: two tabs, or a page that renders several forms from one render,
 * must each hold a usable token without invalidating the others. Only digests are
 * stored, so a dump of the key/value store never yields a submittable token.
 * @extends Record
 */
export default class CsrfTokenRecord extends Record {

    /**
     * Reference schema for persisted CSRF pre-session attributes.
     * @type {Object}
     */
    static schema = {
        type: 'object',
        properties: {
            tokenHashes: {
                type: 'array',
                items: { type: 'string' },
                description: 'SHA-256 hex digests of the live one-time CSRF tokens, oldest first',
            },
            tokenCreationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the CSRF token record was created',
            },
            tokenExpirationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp after which the CSRF token is no longer valid',
            },
        },
        required: [ 'tokenHashes', 'tokenCreationDate', 'tokenExpirationDate' ],
    };

    /**
     * Validates token digests and the fixed pre-session lifetime.
     * @returns {void}
     * @throws {ValidationError} When one or more pre-session attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid CSRF token record');
        const tokenCreationDate = parseIsoDateTime(this.get('tokenCreationDate'));
        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        const tokenHashes = this.get('tokenHashes');

        // A record with no live tokens has nothing left to validate against, so it
        // is not a persistable state; the collection deletes it instead.
        if (!Array.isArray(tokenHashes) ||
            tokenHashes.length === 0 ||
            !tokenHashes.every(isNonEmptyString)) {
            error.push('CsrfToken tokenHashes must be a non-empty array of non-empty strings', 'tokenHashes');
        }
        if (!tokenCreationDate) {
            error.push('CsrfToken tokenCreationDate is required', 'tokenCreationDate');
        }
        if (!tokenExpirationDate) {
            error.push('CsrfToken tokenExpirationDate is required', 'tokenExpirationDate');
        }
        if (tokenCreationDate &&
            tokenExpirationDate &&
            tokenExpirationDate.getTime() <= tokenCreationDate.getTime()) {
            error.push('CsrfToken tokenExpirationDate must be after tokenCreationDate', 'tokenExpirationDate');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Checks the record's embedded expiration timestamp.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True when the token record has expired.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isExpired(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'CsrfTokenRecord#isExpired() referenceDate must be a valid Date');

        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        return !tokenExpirationDate ||
            tokenExpirationDate.getTime() <= referenceDate.getTime();
    }

    /**
     * Seconds remaining before this pre-session expires.
     *
     * Reuse never extends the lifetime, so this is what a refreshed cookie and a
     * rewritten store entry must both be given: the pre-session and its cookie
     * expire together, at the deadline set when the pre-session began.
     *
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {number} Whole seconds remaining, or 0 once expired or unparsable.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    getSecondsUntilExpiration(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'CsrfTokenRecord#getSecondsUntilExpiration() referenceDate must be a valid Date');

        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        if (!tokenExpirationDate) {
            return 0;
        }

        const remainingMs = tokenExpirationDate.getTime() - referenceDate.getTime();
        return Math.max(0, Math.ceil(remainingMs / 1000));
    }

    /**
     * This pre-session's deadline as a Unix timestamp in seconds.
     *
     * Rewriting the record means restating that deadline, and restating it from
     * the stored value is what keeps reuse from extending it: deriving it from
     * the seconds remaining instead would round the deadline a little further
     * out on every render.
     *
     * @returns {number|null} Whole Unix seconds, or null when the stored timestamp is unparsable.
     */
    getExpirationUnixSeconds() {
        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        if (!tokenExpirationDate) {
            return null;
        }

        return Math.floor(tokenExpirationDate.getTime() / 1000);
    }

    /**
     * Reports whether this pre-session has enough life left to be written to again.
     *
     * Callers mint a token into an existing pre-session (or spend one from it)
     * only when this returns true; see MIN_REUSABLE_SECONDS for why a pre-session
     * in its last moments is replaced or dropped rather than rewritten.
     *
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True when at least MIN_REUSABLE_SECONDS remain.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isReusable(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'CsrfTokenRecord#isReusable() referenceDate must be a valid Date');

        const expiresAt = this.getExpirationUnixSeconds();
        if (expiresAt === null) {
            return false;
        }

        return expiresAt - Math.floor(referenceDate.getTime() / 1000) >= MIN_REUSABLE_SECONDS;
    }

    /**
     * Live token digests held by this pre-session, oldest first.
     * @returns {string[]} Stored array by reference, or a new empty array when the attribute is absent or malformed.
     */
    getTokenHashes() {
        const tokenHashes = this.get('tokenHashes');
        return Array.isArray(tokenHashes) ? tokenHashes : [];
    }

    /**
     * Reports whether a digest names a token still live in this pre-session.
     * @param {string} tokenHash - SHA-256 hex digest of a submitted token.
     * @returns {boolean} True only when the digest is currently held.
     */
    hasTokenHash(tokenHash) {
        return isNonEmptyString(tokenHash) && this.getTokenHashes().includes(tokenHash);
    }

    /**
     * Adds a newly minted token digest, evicting the oldest once at the cap.
     * @param {string} tokenHash - SHA-256 hex digest of the new token.
     * @returns {CsrfTokenRecord} This record for chaining.
     * @throws {AssertionError} When tokenHash is not a non-empty string.
     */
    addTokenHash(tokenHash) {
        assert(isNonEmptyString(tokenHash), 'CsrfTokenRecord#addTokenHash() tokenHash must be a non-empty string');

        // slice() from the tail keeps the newest MAX_LIVE_TOKENS, so the tab that
        // rendered longest ago is the one that loses its token.
        const tokenHashes = this.getTokenHashes().concat([ tokenHash ]);
        return this.set('tokenHashes', tokenHashes.slice(-MAX_LIVE_TOKENS));
    }

    /**
     * Removes a spent token digest, leaving every other live token usable.
     * @param {string} tokenHash - SHA-256 hex digest of the consumed token.
     * @returns {CsrfTokenRecord} This record for chaining.
     */
    removeTokenHash(tokenHash) {
        const tokenHashes = this.getTokenHashes().filter((hash) => hash !== tokenHash);
        return this.set('tokenHashes', tokenHashes);
    }
}
