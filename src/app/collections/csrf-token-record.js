import Record from './base-key-value-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { assert, isNonEmptyString, isValidDate } from '../../kixx/assertions/mod.js';


export default class CsrfTokenRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            tokenHash: { type: 'string' },
            tokenCreationDate: { type: 'string', format: 'date-time' },
            tokenExpirationDate: { type: 'string', format: 'date-time' },
        },
        required: [ 'tokenHash', 'tokenCreationDate', 'tokenExpirationDate' ],
    };

    validate() {
        const error = new ValidationError('Invalid CSRF token record');
        const tokenCreationDate = parseDate(this.get('tokenCreationDate'));
        const tokenExpirationDate = parseDate(this.get('tokenExpirationDate'));

        if (!isNonEmptyString(this.get('tokenHash'))) {
            error.push('CsrfToken tokenHash is required', 'tokenHash');
        }
        if (!isValidDate(tokenCreationDate)) {
            error.push('CsrfToken tokenCreationDate is required', 'tokenCreationDate');
        }
        if (!isValidDate(tokenExpirationDate)) {
            error.push('CsrfToken tokenExpirationDate is required', 'tokenExpirationDate');
        }
        if (isValidDate(tokenCreationDate) &&
            isValidDate(tokenExpirationDate) &&
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

        const tokenExpirationDate = parseDate(this.get('tokenExpirationDate'));
        return !isValidDate(tokenExpirationDate) ||
            tokenExpirationDate.getTime() <= referenceDate.getTime();
    }
}

function parseDate(value) {
    if (!isNonEmptyString(value)) {
        return null;
    }

    return new Date(value);
}
