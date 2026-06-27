import { generateSecretToken, sha256Hex } from '../lib/crypto.js';
import Collection from './base-document-store-collection.js';
import PublishingApiTokenRecord from './publishing-api-token-record.js';
import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';


const PUBLISHING_API_TOKEN_PREFIX = 'kxpat_';


/**
 * Table Data Gateway for Publishing API bearer tokens.
 *
 * The record id is the SHA-256 hex digest of the raw bearer token, so lookups
 * are a direct `get()` by hash and the plaintext token is never persisted. The
 * raw token is returned to the caller exactly once, at creation time.
 * @extends Collection
 */
export default class PublishingApiTokenCollection extends Collection {

    static TYPE = 'PublishingApiToken';

    static Record = PublishingApiTokenRecord;

    // List ordering is by creation time so admin tooling can show newest tokens first.
    generateSortKey(doc) {
        return doc?.tokenCreationDate;
    }

    /**
     * Mints a new Publishing API token and returns the one-time plaintext token.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} args - Creation arguments.
     * @param {string} args.createdBy - Admin user id that minted the token.
     * @param {Object[]} args.permissions - Permission grants attached to this token.
     * @param {string|null} [args.description] - Operator-facing token description.
     * @param {number} args.ttlSeconds - Positive token lifetime in seconds.
     * @returns {Promise<{ token: string, record: PublishingApiTokenRecord }>} The raw token and stored record.
     * @throws {AssertionError} When required creation arguments are invalid.
     * @throws {ValidationError} When the generated record fails validation.
     */
    async createToken(context, args) {
        const {
            createdBy,
            permissions,
            description = null,
            ttlSeconds,
        } = args ?? {};

        assertNonEmptyString(createdBy, 'PublishingApiTokenCollection#createToken() createdBy');
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds > 0,
            'PublishingApiTokenCollection#createToken() ttlSeconds must be a positive integer',
        );

        const nowMs = Date.now();
        const token = generateSecretToken(PUBLISHING_API_TOKEN_PREFIX);
        const tokenHash = await sha256Hex(token);

        // Clone permission grants before persistence so later caller mutation
        // cannot change what this write intended to store.
        const record = await this.create(context, {
            id: tokenHash,
            permissions: structuredClone(permissions),
            description,
            createdBy,
            tokenCreationDate: new Date(nowMs).toISOString(),
            tokenExpirationDate: new Date(nowMs + (ttlSeconds * 1000)).toISOString(),
            revokedAt: null,
        });

        return { token, record };
    }

    /**
     * Loads a token by the SHA-256 hex digest of its plaintext secret.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} tokenHash - SHA-256 hex digest of the presented token.
     * @returns {Promise<PublishingApiTokenRecord|null>} Stored token, or null when absent.
     * @throws {AssertionError} When tokenHash is not a non-empty string.
     */
    async getByTokenHash(context, tokenHash) {
        assertNonEmptyString(tokenHash, 'PublishingApiTokenCollection#getByTokenHash() tokenHash');
        return await this.get(context, tokenHash);
    }
}
