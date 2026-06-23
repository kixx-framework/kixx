import Record from './base-key-value-store-record';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


export default class UserSessionRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            userId: { type: 'string' },
            sessionCreationDate: { type: 'string', format: 'date-time' },
            sessionExpirationDate: { type: 'string', format: 'date-time' },
        },
        required: [ 'userId', 'sessionCreationDate' ],
    };

    validate() {
        const error = new ValidationError('Invalid admin user record');

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
