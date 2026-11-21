import Record from './base-key-value-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { assert, isNonEmptyString, isValidDate } from '../../kixx/assertions/mod.js';
import { isIsoDateTime, parseIsoDateTime } from '../lib/iso-date-time.js';


/**
 * Key/value-store DTO for an authenticated admin user session.
 *
 * The embedded expiration timestamp remains authoritative for authentication;
 * the store TTL independently removes expired records.
 * @extends Record
 */
export default class UserSessionRecord extends Record {

    /**
     * Reference schema for persisted administrator-session attributes.
     * @type {Object}
     */
    static schema = {
        type: 'object',
        properties: {
            userId: {
                type: 'string',
                description: 'AdminUser record id authenticated by this session',
            },
            sessionCreationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the user session record was created',
            },
            sessionExpirationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp after which the user session is no longer valid',
            },
        },
        required: [ 'userId', 'sessionCreationDate', 'sessionExpirationDate' ],
    };

    /**
     * Validates the authenticated user id and session timestamps.
     * @returns {void}
     * @throws {ValidationError} When one or more session attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid user session record');

        if (!isNonEmptyString(this.get('userId'))) {
            error.push('UserSessionRecord userId is required', 'userId');
        }
        if (!isIsoDateTime(this.get('sessionCreationDate'))) {
            error.push('UserSessionRecord sessionCreationDate is required', 'sessionCreationDate');
        }
        if (!isIsoDateTime(this.get('sessionExpirationDate'))) {
            error.push('UserSessionRecord sessionExpirationDate is required', 'sessionExpirationDate');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Checks the session's embedded expiration timestamp.
     * @param {Date} [referenceDate] - Date used as the current time.
     * @returns {boolean} True when the session has expired or its timestamp is invalid.
     * @throws {AssertionError} When referenceDate is present and invalid.
     */
    isExpired(referenceDate = new Date()) {
        assert(isValidDate(referenceDate), 'UserSessionRecord#isExpired() referenceDate must be a valid Date');

        const sessionExpirationDate = parseIsoDateTime(this.get('sessionExpirationDate'));
        return !sessionExpirationDate ||
            sessionExpirationDate.getTime() <= referenceDate.getTime();
    }
}
