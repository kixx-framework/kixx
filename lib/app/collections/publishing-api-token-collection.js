import { generateSecretToken, sha256Hex } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import PublishingApiTokenRecord from './publishing-api-token-record.js';
import { assert, assertNonEmptyString } from '../../kixx/assertions/mod.js';
import { isRoleId } from '../permissions/roles.js';


const PUBLISHING_API_TOKEN_PREFIX = 'kxpat_';
const EDITOR_ROLE_CATEGORY = 'editor';


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

    /**
     * Orders API tokens by their creation timestamps.
     * @param {Object} doc - Prepared Publishing API token document.
     * @returns {string|undefined} ISO creation timestamp, or undefined when absent.
     */
    generateSortKey(doc) {
        return doc?.tokenCreationDate;
    }

    /**
     * Mints a new Publishing API token and returns the one-time plaintext token.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} args - Creation arguments.
     * @param {string} args.createdBy - Admin user id that minted the token.
     * @param {string[]} args.roles - Role ids granted to this token.
     * @param {string|null} [args.description] - Operator-facing token description.
     * @param {number} args.ttlSeconds - Positive token lifetime in seconds.
     * @returns {Promise<{ token: string, record: PublishingApiTokenRecord }>} The raw token and stored record.
     * @throws {AssertionError} When required creation arguments are invalid or a role id is
     *   not attachable to a publishing token.
     * @throws {ValidationError} When the generated record fails validation.
     * @throws {DocumentAlreadyExistsError} When the generated token hash already exists.
     */
    async createToken(context, args) {
        const {
            createdBy,
            roles,
            description = null,
            ttlSeconds,
        } = args ?? {};

        assertNonEmptyString(createdBy, 'PublishingApiTokenCollection#createToken() createdBy');
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds > 0,
            'PublishingApiTokenCollection#createToken() ttlSeconds must be a positive integer',
        );
        assert(
            Array.isArray(roles) && roles.length > 0,
            'PublishingApiTokenCollection#createToken() roles must be a non-empty array',
        );
        // One check, not three. An unregistered id carries no category, so it
        // fails this one already, and the role registry proves at import that
        // every editor-category role's grants stay inside the publishing URN
        // domain. Reintroducing either check here would re-derive on every
        // token write what is already true before the first request is served.
        assert(
            roles.every((id) => isRoleId(id, EDITOR_ROLE_CATEGORY)),
            'PublishingApiTokenCollection#createToken() roles must be attachable publishing role ids',
        );

        const nowMs = Date.now();
        const token = generateSecretToken(PUBLISHING_API_TOKEN_PREFIX);
        const tokenHash = await sha256Hex(token);

        // Clone roles before persistence so later caller mutation cannot
        // change what this write intended to store.
        const record = await this.create(context, {
            id: tokenHash,
            roles: roles.slice(),
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

    /**
     * Returns a keyset-paginated page of tokens ordered newest-first.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} [options] - Pagination options.
     * @param {string|null} [options.cursor] - Opaque cursor from a previous page; null starts from the first page.
     * @param {number} [options.limit=100] - Positive integer maximum number of tokens per page.
     * @returns {Promise<{ items: PublishingApiTokenRecord[], cursor: string|null }>} Page of tokens and the next cursor.
     * @throws {AssertionError} When the pagination options are invalid.
     * @throws {InvalidCursorError} When the cursor is invalid or belongs to a different scan.
     */
    async listPage(context, options) {
        const { cursor, limit } = options ?? {};
        return await this.scan(context, { descending: true, cursor, limit });
    }

    /**
     * Revokes a token using optimistic concurrency, making it permanently unusable.
     *
     * This is an unconditional stamp. Callers must confirm the transition is legal
     * with `PublishingApiTokenRecord#isRevocable()` first; stamping an already
     * revoked record would overwrite its original revocation timestamp.
     *
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {PublishingApiTokenRecord} record - Token record previously loaded from this collection.
     * @returns {Promise<PublishingApiTokenRecord>} The updated record.
     * @throws {AssertionError} When record is not a PublishingApiTokenRecord.
     * @throws {ValidationError} When the revoked record violates record invariants.
     * @throws {VersionConflictError} When the token was modified concurrently.
     * @throws {DocumentNotFoundError} When the token no longer exists.
     */
    async revoke(context, record) {
        record.set('revokedAt', new Date().toISOString());
        return await this.update(context, record);
    }
}
