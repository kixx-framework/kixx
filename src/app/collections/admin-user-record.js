import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


export default class AdminUserRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            emailAddress: { type: 'string' },
            passwordHash: {
                type: 'string',
                description: 'PHC-encoded PBKDF2-HMAC-SHA-512 credential string',
            },
            userCreationDate: { type: 'string', format: 'date-time' },
        },
        required: [ 'emailAddress', 'passwordHash', 'userCreationDate' ],
    };

    validate() {
        const error = new ValidationError('Invalid admin user record');

        if (isNonEmptyString(this.get('emailAddress'))) {
            error.push('AdminUser emailAddress is required', 'emailAddress');
        }
        if (isNonEmptyString(this.get('passwordHash'))) {
            error.push('AdminUser passwordHash is required', 'passwordHash');
        }
        if (isNonEmptyString(this.get('userCreationDate'))) {
            error.push('AdminUser userCreationDate is required', 'userCreationDate');
        }

        if (error.length) {
            throw error;
        }
    }
}
