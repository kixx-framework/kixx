import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';


/**
 * Document-store DTO for an administrator account.
 *
 * Generic object projections omit the password hash, while
 * `toAuthenticatedUser()` exposes the identity and role fields used by request
 * authentication.
 * @extends Record
 */
export default class AdminUserRecord extends Record {

    /**
     * Reference schema for persisted administrator attributes.
     * @type {Object}
     */
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
            roles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Role names granted to this admin user',
            },
        },
        required: [ 'emailAddress', 'passwordHash', 'userCreationDate', 'roles' ],
    };

    /**
     * Validates the account attributes required for persistence.
     * @returns {void}
     * @throws {ValidationError} When one or more account attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid admin user record');
        const roles = this.get('roles');

        if (!isNonEmptyString(this.get('emailAddress'))) {
            error.push('AdminUser emailAddress is required', 'emailAddress');
        }
        if (!isNonEmptyString(this.get('passwordHash'))) {
            error.push('AdminUser passwordHash is required', 'passwordHash');
        }
        if (!isNonEmptyString(this.get('userCreationDate'))) {
            error.push('AdminUser userCreationDate is required', 'userCreationDate');
        }
        // Empty roles is valid, and membership in the role registry is not
        // checked here so a retired role name does not brick an existing
        // record (see roles.js: unknown names simply derive no permissions).
        if (!Array.isArray(roles) || !roles.every(isNonEmptyString)) {
            error.push('AdminUser roles must be an array of non-empty strings', 'roles');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Reformats this record into a plain JavaScript Object, same as the base
     * implementation, but omitting `passwordHash` so the credential hash never
     * leaves the data source layer through a generic projection.
     * @returns {Object} Document attributes plus `type`, `id`, and `meta`, excluding `passwordHash`.
     */
    toObject() {
        const object = super.toObject();
        delete object.passwordHash;
        return object;
    }

    /**
     * Projects the record into a safe authenticated-user object for the request
     * context and session. Deliberately omits the password hash so the credential
     * never leaves the data source layer. Carries raw role names only —
     * deriving grants from those names is authentication middleware's job, not
     * this projection's.
     * @returns {{ id: string, type: string, emailAddress: string, userCreationDate: string, roles: string[] }}
     */
    toAuthenticatedUser() {
        return {
            id: this.id,
            type: this.type,
            emailAddress: this.get('emailAddress'),
            userCreationDate: this.get('userCreationDate'),
            roles: this.get('roles'),
        };
    }
}
