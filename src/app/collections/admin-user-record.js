import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


export default class AdminUserRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            emailAddress: {
                type: 'string',
                description: 'Normalized email address used to sign in to the admin panel',
            },
            passwordHash: {
                type: 'string',
                description: 'PHC-encoded PBKDF2-HMAC-SHA-512 credential string',
            },
            userCreationDate: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the admin user record was created',
            },
        },
        required: [ 'emailAddress', 'passwordHash', 'userCreationDate' ],
    };

    validate() {
        const error = new ValidationError('Invalid admin user record');

        if (!isNonEmptyString(this.get('emailAddress'))) {
            error.push('AdminUser emailAddress is required', 'emailAddress');
        }
        if (!isNonEmptyString(this.get('passwordHash'))) {
            error.push('AdminUser passwordHash is required', 'passwordHash');
        }
        if (!isNonEmptyString(this.get('userCreationDate'))) {
            error.push('AdminUser userCreationDate is required', 'userCreationDate');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Projects the record into a safe authenticated-user object for the request
     * context and session. Deliberately omits the password hash so the credential
     * never leaves the data source layer.
     * @returns {{ id: string, type: string, emailAddress: string, userCreationDate: string }}
     */
    toAuthenticatedUser() {
        return {
            id: this.id,
            type: this.type,
            emailAddress: this.get('emailAddress'),
            userCreationDate: this.get('userCreationDate'),
        };
    }
}
