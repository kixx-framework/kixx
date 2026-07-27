import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { assert, isNonEmptyString, isValidDate } from '../../kixx/assertions/mod.js';
import { isIsoDateTime, parseIsoDateTime } from '../lib/iso-date-time.js';


/**
 * Invite kind for a normal admin-minted, single-use invite that can be redeemed.
 * @type {string}
 */
export const ADMIN_INVITE_KIND = 'invite';

/**
 * Invite kind for the consumed-marker written when the env `ADMIN_BOOTSTRAP_TOKEN`
 * is spent. A bootstrap record is created already-consumed and is never redeemable;
 * its only job is to make the bootstrap token single-use in a runtime where the
 * env var itself cannot be mutated.
 * @type {string}
 */
export const ADMIN_INVITE_BOOTSTRAP_KIND = 'bootstrap';

const INVITE_KINDS = new Set([ ADMIN_INVITE_KIND, ADMIN_INVITE_BOOTSTRAP_KIND ]);


/**
 * Document-store DTO for an admin invite. The record id is the SHA-256 hex digest
 * of the raw bearer token (set by the collection), so the plaintext token is never
 * stored. Single-use state lives in `consumedAt`; revocation lives in `revokedAt`.
 * @extends Record
 */
export default class AdminInviteRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            kind: {
                type: 'string',
                enum: [ ADMIN_INVITE_KIND, ADMIN_INVITE_BOOTSTRAP_KIND ],
                description: 'Invite type: redeemable admin invite or consumed bootstrap marker',
            },
            createdBy: {
                type: 'string',
                description: 'Admin user id that created the invite, or bootstrap for env-token markers',
            },
            inviteCreationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the invite record was created',
            },
            inviteExpirationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp after which a pending invite is no longer redeemable',
            },
            consumedAt: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp when the invite was redeemed, or null while unused',
            },
            revokedAt: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp when the invite was revoked, or null while not revoked',
            },
            roles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Role name(s) this invite confers on redemption',
            },
            rolePreset: {
                type: [ 'string', 'null' ],
                description: 'Name of the role preset the invite was created from, or null when none applies',
            },
        },
        required: [
            'kind',
            'createdBy',
            'inviteCreationDate',
            'inviteExpirationDate',
            'consumedAt',
            'revokedAt',
            'roles',
            'rolePreset',
        ],
    };

    validate() {
        const error = new ValidationError('Invalid admin invite record');
        const kind = this.get('kind');
        const inviteCreationDate = parseIsoDateTime(this.get('inviteCreationDate'));
        const inviteExpirationDate = parseIsoDateTime(this.get('inviteExpirationDate'));
        const consumedAt = this.get('consumedAt');
        const revokedAt = this.get('revokedAt');
        const roles = this.get('roles');
        const rolePreset = this.get('rolePreset');

        if (!INVITE_KINDS.has(kind)) {
            error.push('AdminInvite kind must be "invite" or "bootstrap"', 'kind');
        }
        // Empty roles is valid, and membership in the role registry is not
        // checked here so a retired role name does not brick an existing
        // record (see roles.js: unknown names simply derive no permissions).
        if (!Array.isArray(roles) || !roles.every(isNonEmptyString)) {
            error.push('AdminInvite roles must be an array of non-empty strings', 'roles');
        }
        // rolePreset is a display and audit label only; `roles` is what the
        // invite actually confers. Like `roles` above, the value is not checked
        // against the preset registry, so redefining or retiring a preset later
        // cannot invalidate an invite already issued under the old name.
        if (rolePreset !== null && rolePreset !== undefined && !isNonEmptyString(rolePreset)) {
            error.push('AdminInvite rolePreset must be a non-empty string when present', 'rolePreset');
        }
        if (!isNonEmptyString(this.get('createdBy'))) {
            error.push('AdminInvite createdBy is required', 'createdBy');
        }
        if (!inviteCreationDate) {
            error.push('AdminInvite inviteCreationDate is required', 'inviteCreationDate');
        }
        if (!inviteExpirationDate) {
            error.push('AdminInvite inviteExpirationDate is required', 'inviteExpirationDate');
        }

        // The expiration ordering rule only applies to redeemable invites. A bootstrap
        // marker is born already-consumed and carries equal creation/expiration
        // timestamps purely as bookkeeping, so it is exempt from the ordering check.
        if (kind === ADMIN_INVITE_KIND &&
            inviteCreationDate &&
            inviteExpirationDate &&
            inviteExpirationDate.getTime() <= inviteCreationDate.getTime()) {
            error.push('AdminInvite inviteExpirationDate must be after inviteCreationDate', 'inviteExpirationDate');
        }

        // consumedAt and revokedAt are optional (null until set), but when present
        // they must be parsable timestamps so status derivation stays reliable.
        if (consumedAt !== null && consumedAt !== undefined && !isIsoDateTime(consumedAt)) {
            error.push('AdminInvite consumedAt must be a valid date when present', 'consumedAt');
        }
        if (revokedAt !== null && revokedAt !== undefined && !isIsoDateTime(revokedAt)) {
            error.push('AdminInvite revokedAt must be a valid date when present', 'revokedAt');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Derives the current lifecycle status from the stored fields.
     *
     * Precedence is revoked > consumed > expired > pending: an invite that was both
     * consumed and later expired by the clock still reports `consumed`, because the
     * terminal state that actually happened is the meaningful one.
     *
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {'revoked'|'consumed'|'expired'|'pending'} Derived invite status.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    getStatus(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'AdminInviteRecord#getStatus() referenceDate must be a valid Date');

        if (isNonEmptyString(this.get('revokedAt'))) {
            return 'revoked';
        }
        if (isNonEmptyString(this.get('consumedAt'))) {
            return 'consumed';
        }

        const inviteExpirationDate = parseIsoDateTime(this.get('inviteExpirationDate'));
        if (!inviteExpirationDate ||
            inviteExpirationDate.getTime() <= referenceDate.getTime()) {
            return 'expired';
        }

        return 'pending';
    }

    /**
     * Reports whether this invite can still be redeemed.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True only when the derived status is `pending`.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isRedeemable(referenceDate = new Date()) {
        return this.getStatus(referenceDate) === 'pending';
    }

    /**
     * Reports whether this invite may still be revoked.
     *
     * Revocation is a transition into a terminal state, so it is only legal from a
     * non-terminal one. `pending` is the ordinary case and `expired` is allowed as a
     * harmless tightening (an expired invite is already unredeemable, and an operator
     * may want it recorded as deliberately withdrawn). `consumed` and `revoked` are
     * refused: because `getStatus()` ranks revoked above consumed, stamping a consumed
     * invite would flip it to `revoked` and erase the record that it was actually
     * redeemed into a live admin account — while doing nothing to that account.
     * Re-revoking would likewise overwrite the original revocation timestamp.
     *
     * A bootstrap marker is never revocable: it is bookkeeping that makes the env
     * token single-use, not an invite anyone can redeem.
     *
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True only for a non-bootstrap invite in the `pending` or `expired` state.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isRevocable(referenceDate = new Date()) {
        // Checked before the status so the refusal does not depend on the marker
        // happening to derive `consumed` from its self-consumed timestamps.
        if (this.get('kind') !== ADMIN_INVITE_KIND) {
            return false;
        }

        const status = this.getStatus(referenceDate);
        return status === 'pending' || status === 'expired';
    }
}
