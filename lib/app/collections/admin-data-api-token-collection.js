import { generateSecretToken, sha256Hex } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import AdminDataApiTokenRecord from './admin-data-api-token-record.js';
import { assert, assertNonEmptyString, isPlainObject } from '../../kixx/assertions/mod.js';
import { ADMIN_DATA_ACTIONS } from '../permissions/admin-data-api.js';
import { adminDataResources } from '../admin-data-api/mod.js';


/**
 * Literal prefix of every Administrative Data API token. Distinct from the
 * Publishing API's `kxpat_` so the two credential domains are recognizable on
 * sight and a token presented to the wrong API is rejected before lookup.
 * @type {string}
 */
export const ADMIN_DATA_API_TOKEN_PREFIX = 'kxadt_';


/**
 * Table Data Gateway for Administrative Data API bearer tokens.
 *
 * The record id is the SHA-256 hex digest of the raw bearer token, so lookups
 * are a direct `get()` by hash and the plaintext token is never persisted. The
 * raw token is returned to the caller exactly once, at creation time.
 * @extends Collection
 */
export default class AdminDataApiTokenCollection extends Collection {

    static TYPE = 'AdminDataApiToken';

    static Record = AdminDataApiTokenRecord;

    /**
     * Orders tokens by their creation timestamps.
     * @param {Object} doc - Prepared token document.
     * @returns {string|undefined} ISO creation timestamp, or undefined when absent.
     */
    generateSortKey(doc) {
        return doc?.tokenCreationDate;
    }

    /**
     * Mints a new token and returns the one-time plaintext secret.
     *
     * Grants must already be validated against the resource registry by the
     * caller's Form; a grant for an unregistered Collection or a disabled
     * operation reaching this method is a programmer error. Grants are stored
     * in a canonical order so equal access always looks the same.
     *
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} args - Creation arguments.
     * @param {string} args.createdBy - Admin user id that minted the token.
     * @param {Object[]} args.grants - Non-empty `{ collection, actions }` grants.
     * @param {string|null} [args.description] - Operator-facing token description.
     * @param {number} args.ttlSeconds - Positive token lifetime in seconds.
     * @returns {Promise<{ token: string, record: AdminDataApiTokenRecord }>} The raw token and stored record.
     * @throws {AssertionError} When arguments are invalid or a grant exceeds the registry.
     * @throws {ValidationError} When the generated record fails validation.
     * @throws {DocumentAlreadyExistsError} When the generated token hash already exists.
     */
    async createToken(context, args) {
        const {
            createdBy,
            grants,
            description = null,
            ttlSeconds,
        } = args ?? {};

        assertNonEmptyString(createdBy, 'AdminDataApiTokenCollection#createToken() createdBy');
        assert(
            Number.isInteger(ttlSeconds) && ttlSeconds > 0,
            'AdminDataApiTokenCollection#createToken() ttlSeconds must be a positive integer',
        );
        assert(
            Array.isArray(grants) && grants.length > 0,
            'AdminDataApiTokenCollection#createToken() grants must be a non-empty array',
        );

        const nowMs = Date.now();
        const token = generateSecretToken(ADMIN_DATA_API_TOKEN_PREFIX);
        const tokenHash = await sha256Hex(token);

        const record = await this.create(context, {
            id: tokenHash,
            grants: canonicalizeGrants(grants),
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
     * @returns {Promise<AdminDataApiTokenRecord|null>} Stored token, or null when absent.
     * @throws {AssertionError} When tokenHash is not a non-empty string.
     */
    async getByTokenHash(context, tokenHash) {
        assertNonEmptyString(tokenHash, 'AdminDataApiTokenCollection#getByTokenHash() tokenHash');
        return await this.get(context, tokenHash);
    }

    /**
     * Returns a keyset-paginated page of tokens ordered newest-first.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} [options] - Pagination options.
     * @param {string|null} [options.cursor] - Opaque cursor from a previous page; null starts from the first page.
     * @param {number} [options.limit=100] - Positive integer maximum number of tokens per page.
     * @returns {Promise<{ items: AdminDataApiTokenRecord[], cursor: string|null }>} Page of tokens and the next cursor.
     * @throws {AssertionError} When the pagination options are invalid.
     * @throws {InvalidCursorError} When the cursor is invalid or belongs to a different scan.
     */
    async listPage(context, options) {
        const { cursor, limit } = options ?? {};
        return await this.scan(context, { descending: true, cursor, limit });
    }

    /**
     * Revokes a token on the version it was loaded at, making it permanently unusable.
     *
     * This is an unconditional stamp on that version. Callers must confirm the
     * transition is legal with `AdminDataApiTokenRecord#isRevocable()` first.
     * Because the write is version-checked and never retried, a concurrent
     * revocation fails with a conflict instead of overwriting the original
     * revocation timestamp.
     *
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {AdminDataApiTokenRecord} record - Token record previously loaded from this collection.
     * @returns {Promise<AdminDataApiTokenRecord>} The updated record.
     * @throws {AssertionError} When record is not an AdminDataApiTokenRecord.
     * @throws {ValidationError} When the revoked record violates record invariants.
     * @throws {VersionConflictError} When the token was modified concurrently.
     * @throws {DocumentNotFoundError} When the token no longer exists.
     */
    async revoke(context, record) {
        record.set('revokedAt', new Date().toISOString());
        return await this.update(context, record);
    }
}

function canonicalizeGrants(grants) {
    const collections = new Set();

    const canonical = grants.map((grant, index) => {
        const label = `AdminDataApiTokenCollection#createToken() grants[${ index }]`;
        assert(isPlainObject(grant), `${ label } must be a plain object`);

        const resource = adminDataResources.getResourceByCollection(grant.collection);
        assert(resource, `${ label } names unregistered Collection '${ grant.collection }'`);
        assert(!collections.has(grant.collection), `${ label } repeats Collection '${ grant.collection }'`);
        collections.add(grant.collection);

        assert(
            Array.isArray(grant.actions) && grant.actions.length > 0,
            `${ label } actions must be a non-empty array`,
        );
        for (const action of grant.actions) {
            assert(
                adminDataResources.isOperationEnabled(resource.type, action),
                `${ label } action '${ action }' is not enabled for '${ grant.collection }'`,
            );
        }

        // Copy into canonical action order so caller mutation cannot change
        // what this write intended to store, and duplicates collapse.
        return {
            collection: grant.collection,
            actions: ADMIN_DATA_ACTIONS.filter((action) => grant.actions.includes(action)),
        };
    });

    return canonical.sort((a, b) => (a.collection < b.collection ? -1 : 1));
}
