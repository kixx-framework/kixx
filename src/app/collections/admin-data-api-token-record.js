import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isPlainObject,
    isString,
    isValidDate,
} from '../../kixx/assertions/mod.js';
import { isIsoDateTime, parseIsoDateTime } from '../lib/iso-date-time.js';
import { isAdminDataAction, isAdminDataCollectionName } from '../permissions/admin-data-api.js';


/**
 * Document-store DTO for an Administrative Data API bearer token.
 *
 * The record id is the SHA-256 hex digest of the raw token, so the plaintext
 * secret is never stored. Grants are immutable after minting; revocation and
 * expiration are derived from stored timestamps.
 * @extends Record
 */
export default class AdminDataApiTokenRecord extends Record {

    /**
     * Reference schema for persisted token attributes.
     * @type {Object}
     */
    static schema = {
        type: 'object',
        properties: {
            grants: {
                type: 'array',
                description: 'Per-Collection action grants carried by this token',
                items: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string' },
                        actions: { type: 'array', items: { type: 'string' } },
                    },
                    required: [ 'collection', 'actions' ],
                },
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
            'grants',
            'description',
            'createdBy',
            'tokenCreationDate',
            'tokenExpirationDate',
            'revokedAt',
        ],
    };

    /**
     * Validates grant shape, audit fields, and lifecycle timestamps.
     *
     * Grants are checked for shape only. Whether a Collection is still
     * registered is decided at authorization time, so retiring a registration
     * never makes an already-stored token record invalid.
     *
     * @returns {void}
     * @throws {ValidationError} When one or more token attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid admin data API token record');
        const description = this.get('description');
        const tokenCreationDate = parseIsoDateTime(this.get('tokenCreationDate'));
        const tokenExpirationDate = parseIsoDateTime(this.get('tokenExpirationDate'));
        const revokedAt = this.get('revokedAt');

        if (!isValidGrantList(this.get('grants'))) {
            error.push('AdminDataApiToken grants must be a non-empty list of Collection action grants', 'grants');
        }
        if (description !== null && !isString(description)) {
            error.push('AdminDataApiToken description must be a string or null', 'description');
        }
        if (!isNonEmptyString(this.get('createdBy'))) {
            error.push('AdminDataApiToken createdBy is required', 'createdBy');
        }
        if (!tokenCreationDate) {
            error.push('AdminDataApiToken tokenCreationDate is required', 'tokenCreationDate');
        }
        if (!tokenExpirationDate) {
            error.push('AdminDataApiToken tokenExpirationDate is required', 'tokenExpirationDate');
        }
        if (revokedAt !== null && !isIsoDateTime(revokedAt)) {
            error.push('AdminDataApiToken revokedAt must be a valid date or null', 'revokedAt');
        }

        if (tokenCreationDate &&
            tokenExpirationDate &&
            tokenExpirationDate.getTime() <= tokenCreationDate.getTime()) {
            error.push('AdminDataApiToken tokenExpirationDate must be after tokenCreationDate', 'tokenExpirationDate');
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
        assert(isValidDate(referenceDate), 'AdminDataApiTokenRecord#getStatus() referenceDate must be a valid Date');

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
     * Reports whether this token may still be revoked. Only an active token
     * may be: re-revoking would overwrite the original revocation timestamp,
     * and an expired token is already unusable.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True only when the derived status is `active`.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isRevocable(referenceDate = new Date()) {
        return this.getStatus(referenceDate) === 'active';
    }
}

function isValidGrantList(grants) {
    if (!Array.isArray(grants) || grants.length === 0) {
        return false;
    }

    const collections = new Set();

    for (const grant of grants) {
        if (!isPlainObject(grant) ||
            !isAdminDataCollectionName(grant.collection) ||
            collections.has(grant.collection) ||
            !Array.isArray(grant.actions) ||
            grant.actions.length === 0 ||
            !grant.actions.every(isAdminDataAction) ||
            new Set(grant.actions).size !== grant.actions.length) {
            return false;
        }

        collections.add(grant.collection);
    }

    return true;
}
