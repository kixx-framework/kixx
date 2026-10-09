import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isString,
    isValidDate,
} from '../../kixx/assertions/mod.js';
import { isIsoDateTime, parseIsoDateTime } from '../lib/iso-date-time.js';


/**
 * Document-store DTO for a Publishing API bearer token.
 *
 * The record id is the SHA-256 hex digest of the raw token, so the plaintext
 * secret is never stored. Revocation and expiration are derived from stored
 * timestamps.
 * @extends Record
 */
export default class PublishingApiTokenRecord extends Record {

    /**
     * Reference schema for persisted Publishing API token attributes.
     * @type {Object}
     */
    static schema = {
        type: 'object',
        properties: {
            roles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Role names granted to this token',
            },
            description: {
                type: [ 'string', 'null' ],
                description: 'Operator-facing token description, or null',
            },
            createdBy: {
                type: 'string',
                description: 'Admin user id that minted the token',
            },
            tokenCreationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the token record was created',
            },
            tokenExpirationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp after which the token cannot authenticate',
            },
            revokedAt: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp when the token was revoked, or null while not revoked',
            },
        },
        required: [
            'roles',
            'description',
            'createdBy',
            'tokenCreationDate',
            'tokenExpirationDate',
            'revokedAt',
        ],
    };

    /**
     * Validates token grants, audit fields, and lifecycle timestamps.
     * @returns {void}
     * @throws {ValidationError} When one or more token attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid publishing API token record');
        const roles = this.get('roles');
        const description = this.get('description');
        const tokenCreationDate = parseIsoDateTime(this.get('tokenCreationDate'));
        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        const revokedAt = this.get('revokedAt');

        // Roles may be an empty array (a token with no grants); membership in
        // the role registry is not checked here so a retired role name does
        // not brick an already-stored record (see roles.js: unknown names
        // simply derive no permissions).
        if (!Array.isArray(roles) || !roles.every(isNonEmptyString)) {
            error.push('PublishingApiToken roles must be an array of non-empty strings', 'roles');
        }
        if (description !== null && !isString(description)) {
            error.push('PublishingApiToken description must be a string or null', 'description');
        }
        if (!isNonEmptyString(this.get('createdBy'))) {
            error.push('PublishingApiToken createdBy is required', 'createdBy');
        }
        if (!tokenCreationDate) {
            error.push('PublishingApiToken tokenCreationDate is required', 'tokenCreationDate');
        }
        if (!tokenExpirationDate) {
            error.push('PublishingApiToken tokenExpirationDate is required', 'tokenExpirationDate');
        }
        if (revokedAt !== null && !isIsoDateTime(revokedAt)) {
            error.push('PublishingApiToken revokedAt must be a valid date or null', 'revokedAt');
        }

        if (tokenCreationDate &&
            tokenExpirationDate &&
            tokenExpirationDate.getTime() <= tokenCreationDate.getTime()) {
            error.push('PublishingApiToken tokenExpirationDate must be after tokenCreationDate', 'tokenExpirationDate');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Derives the current lifecycle status from the stored fields.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {'revoked'|'expired'|'active'} Derived token status.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    getStatus(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'PublishingApiTokenRecord#getStatus() referenceDate must be a valid Date');

        if (isNonEmptyString(this.get('revokedAt'))) {
            return 'revoked';
        }

        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        if (!tokenExpirationDate ||
            tokenExpirationDate.getTime() <= referenceDate.getTime()) {
            return 'expired';
        }

        return 'active';
    }

    /**
     * Reports whether this token can authenticate requests.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True only when the derived status is `active`.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isActive(referenceDate = new Date()) {
        return this.getStatus(referenceDate) === 'active';
    }

    /**
     * Reports whether this token may still be revoked.
     *
     * Revocation is only legal for an active token. An expired token is already
     * unusable, while re-revoking a revoked token would overwrite its original
     * revocation timestamp and destroy audit history.
     *
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True only when the derived status is `active`.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isRevocable(referenceDate = new Date()) {
        return this.getStatus(referenceDate) === 'active';
    }
}
