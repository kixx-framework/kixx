import { generateSecretToken, sha256Hex } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import AdminInviteRecord, {
    ADMIN_INVITE_KIND,
    ADMIN_INVITE_BOOTSTRAP_KIND,
} from './admin-invite-record.js';
import { assertNonEmptyString } from '../../kixx/assertions/mod.js';


/**
 * Lifetime of a newly minted admin invite. Invites are persisted in the document
 * store (not the KV store), so expiry is enforced by the `inviteExpirationDate`
 * field rather than a store TTL.
 * @type {number}
 * @readonly
 */
export const ADMIN_INVITE_TTL_SECONDS = 60 * 60 * 72;

/**
 * `createdBy` value recorded for the env-token bootstrap consumed-marker, which
 * has no authenticated admin owner.
 * @type {string}
 * @readonly
 */
export const ADMIN_INVITE_BOOTSTRAP_CREATED_BY = 'bootstrap';


/**
 * Table Data Gateway for single-use admin invite tokens.
 *
 * The record id is the SHA-256 hex digest of the raw bearer token, so lookups
 * are a direct `get()` by hash and the plaintext token is never persisted. The
 * raw token is returned to the caller exactly once, at creation time.
 * @extends Collection
 */
export default class AdminInviteCollection extends Collection {

    static TYPE = 'AdminInvite';

    static Record = AdminInviteRecord;

    /**
     * Orders invites by their creation timestamps.
     * @param {Object} doc - Prepared admin invite document.
     * @returns {string|undefined} ISO creation timestamp, or undefined when absent.
     */
    generateSortKey(doc) {
        return doc?.inviteCreationDate;
    }

    /**
     * Mints a new pending invite and returns the one-time plaintext token.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} args - Creation arguments.
     * @param {string} args.createdBy - Admin user id that authored the invite.
     * @param {string[]} [args.roles=[]] - Role name(s) the invite confers on redemption.
     * @param {string|null} [args.rolePreset=null] - Name of the preset these roles were expanded from.
     * @returns {Promise<{ token: string, record: AdminInviteRecord }>} The raw token (shown once) and stored record.
     * @throws {AssertionError} When createdBy is not a non-empty string.
     * @throws {ValidationError} When the generated record fails validation.
     * @throws {DocumentAlreadyExistsError} When the generated token hash already exists.
     */
    async createInvite(context, args) {
        // Default the optional fields at this create-call boundary (not in
        // AdminInviteRecord#validate()); the roles and the preset name they were
        // expanded from are both chosen by the calling Transaction Script.
        const { createdBy, roles = [], rolePreset = null } = args ?? {};
        assertNonEmptyString(createdBy, 'AdminInviteCollection#createInvite() createdBy');

        const nowMs = Date.now();
        const token = generateSecretToken();
        const tokenHash = await sha256Hex(token);

        // The token hash is the record id, so a presented token resolves to its
        // record with a single get() and the plaintext token is never stored.
        const record = await this.create(context, {
            id: tokenHash,
            kind: ADMIN_INVITE_KIND,
            createdBy,
            inviteCreationDate: new Date(nowMs).toISOString(),
            inviteExpirationDate: new Date(nowMs + (ADMIN_INVITE_TTL_SECONDS * 1000)).toISOString(),
            consumedAt: null,
            revokedAt: null,
            roles,
            rolePreset,
        });

        return { token, record };
    }

    /**
     * Loads an invite by the SHA-256 hex digest of its token.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} tokenHash - SHA-256 hex digest of the presented token.
     * @returns {Promise<AdminInviteRecord|null>} Stored invite, or null when no invite exists for the hash.
     * @throws {AssertionError} When tokenHash is not a non-empty string.
     */
    async getByTokenHash(context, tokenHash) {
        assertNonEmptyString(tokenHash, 'AdminInviteCollection#getByTokenHash() tokenHash');
        return await this.get(context, tokenHash);
    }

    /**
     * Marks a pending invite consumed using optimistic concurrency.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {AdminInviteRecord} record - Invite record previously loaded from this collection.
     * @returns {Promise<AdminInviteRecord>} The updated record.
     * @throws {AssertionError} When record is not an AdminInviteRecord.
     * @throws {ValidationError} When the consumed record violates record invariants.
     * @throws {VersionConflictError} When the invite was modified concurrently (e.g. a racing redemption).
     * @throws {DocumentNotFoundError} When the invite no longer exists.
     */
    async markConsumed(context, record) {
        record.set('consumedAt', new Date().toISOString());
        return await this.update(context, record);
    }

    /**
     * Writes the already-consumed marker that makes a spent bootstrap token single-use.
     *
     * The marker id is the bootstrap token's hash, so re-presenting the same token
     * surfaces a `DocumentAlreadyExistsError` from the store; the caller treats that
     * as "already used".
     *
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} tokenHash - SHA-256 hex digest of the env bootstrap token.
     * @returns {Promise<AdminInviteRecord>} The stored consumed marker.
     * @throws {AssertionError} When tokenHash is not a non-empty string.
     * @throws {ValidationError} When the generated marker violates record invariants.
     * @throws {DocumentAlreadyExistsError} When the bootstrap token has already been spent.
     */
    async createConsumedBootstrapMarker(context, tokenHash) {
        assertNonEmptyString(tokenHash, 'AdminInviteCollection#createConsumedBootstrapMarker() tokenHash');

        const now = new Date().toISOString();
        return await this.create(context, {
            id: tokenHash,
            kind: ADMIN_INVITE_BOOTSTRAP_KIND,
            createdBy: ADMIN_INVITE_BOOTSTRAP_CREATED_BY,
            inviteCreationDate: now,
            inviteExpirationDate: now,
            consumedAt: now,
            revokedAt: null,
            // The bootstrap marker never carries a chosen role or preset —
            // bootstrap redemption confers Root Admin directly, not from this
            // record, and Root Admin is reachable through no preset at all.
            roles: [],
            rolePreset: null,
        });
    }

    /**
     * Revokes an invite using optimistic concurrency, making it permanently unredeemable.
     *
     * This is an unconditional stamp. Callers must confirm the transition is legal
     * with `AdminInviteRecord#isRevocable()` first; stamping a consumed or already
     * revoked record would overwrite terminal state that cannot be recovered.
     *
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {AdminInviteRecord} record - Invite record previously loaded from this collection.
     * @returns {Promise<AdminInviteRecord>} The updated record.
     * @throws {AssertionError} When record is not an AdminInviteRecord.
     * @throws {ValidationError} When the revoked record violates record invariants.
     * @throws {VersionConflictError} When the invite was modified concurrently.
     * @throws {DocumentNotFoundError} When the invite no longer exists.
     */
    async revoke(context, record) {
        record.set('revokedAt', new Date().toISOString());
        return await this.update(context, record);
    }

    /**
     * Returns a keyset-paginated page of invites ordered newest-first.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} [options] - Pagination options.
     * @param {string|null} [options.cursor] - Opaque cursor from a previous page; null starts from the first page.
     * @param {number} [options.limit=100] - Positive integer maximum number of invites per page.
     * @returns {Promise<{ items: AdminInviteRecord[], cursor: string|null }>} Page of invites and the next cursor.
     * @throws {AssertionError} When the pagination options are invalid.
     * @throws {InvalidCursorError} When the cursor is invalid or belongs to a different scan.
     */
    async listPage(context, options) {
        const { cursor, limit } = options ?? {};
        return await this.scan(context, { descending: true, cursor, limit });
    }
}
