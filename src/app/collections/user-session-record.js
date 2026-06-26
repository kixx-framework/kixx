import Record from './base-key-value-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


export default class UserSessionRecord extends Record {

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

    validate() {
        const error = new ValidationError('Invalid user session record');

        if (!isNonEmptyString(this.get('userId'))) {
            error.push('UserSessionRecord userId is required', 'userId');
        }
        if (!isNonEmptyString(this.get('sessionCreationDate'))) {
            error.push('UserSessionRecord sessionCreationDate is required', 'sessionCreationDate');
        }
        if (!isNonEmptyString(this.get('sessionExpirationDate'))) {
            error.push('UserSessionRecord sessionExpirationDate is required', 'sessionExpirationDate');
        }

        if (error.length) {
            throw error;
        }
    }
}
