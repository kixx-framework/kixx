import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isString,
    isValidDate,
} from '../../kixx/assertions/mod.js';


/**
 * Document-store DTO for a Publishing API bearer token.
 *
 * The record id is the SHA-256 hex digest of the raw token, so the plaintext
 * secret is never stored. Revocation and expiration are derived from stored
 * timestamps.
 * @extends Record
 */
export default class PublishingApiTokenRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            permissions: {
                type: 'array',
                description: 'Permission grants attached to this token',
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
            'permissions',
            'description',
            'createdBy',
            'tokenCreationDate',
            'tokenExpirationDate',
            'revokedAt',
        ],
    };

    validate() {
        const error = new ValidationError('Invalid publishing API token record');
        const permissions = this.get('permissions');
        const description = this.get('description');
        const tokenCreationDate = parseDate(this.get('tokenCreationDate'));
        const tokenExpirationDate = parseDate(this.get('tokenExpirationDate'));
        const revokedAt = this.get('revokedAt');

        if (!Array.isArray(permissions) || permissions.length === 0) {
            error.push('PublishingApiToken permissions must be a non-empty array', 'permissions');
        }
        if (description !== null && !isString(description)) {
            error.push('PublishingApiToken description must be a string or null', 'description');
        }
        if (!isNonEmptyString(this.get('createdBy'))) {
            error.push('PublishingApiToken createdBy is required', 'createdBy');
        }
        if (!isValidDate(tokenCreationDate)) {
            error.push('PublishingApiToken tokenCreationDate is required', 'tokenCreationDate');
        }
        if (!isValidDate(tokenExpirationDate)) {
            error.push('PublishingApiToken tokenExpirationDate is required', 'tokenExpirationDate');
        }
        if (revokedAt !== null && !isValidDate(parseDate(revokedAt))) {
            error.push('PublishingApiToken revokedAt must be a valid date or null', 'revokedAt');
        }

        if (isValidDate(tokenCreationDate) &&
            isValidDate(tokenExpirationDate) &&
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

        const tokenExpirationDate = parseDate(this.get('tokenExpirationDate'));
        if (!isValidDate(tokenExpirationDate) ||
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
}

function parseDate(value) {
    if (!isNonEmptyString(value)) {
        return null;
    }

    return new Date(value);
}
