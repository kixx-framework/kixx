import { generateShortId } from '../../kixx/utils/crypto.js';
import Collection from './base-document-store-collection.js';
import AdminUserRecord from './admin-user-record.js';


/**
 * Secondary index name used to look up admin users by email address.
 * Registered in DOCUMENT_STORE_INDEXES (app/app.js) against `$.emailAddress`.
 * @type {string}
 * @readonly
 */
export const ADMIN_USER_EMAIL_ADDRESS_INDEX = 'admin_user_email_address';


/**
 * Table Data Gateway for administrator accounts.
 *
 * Records use generated short ids, sort by creation timestamp, and enforce a
 * unique email-address index for sign-in lookups.
 * @extends Collection
 */
export default class AdminUserCollection extends Collection {

    static TYPE = 'AdminUser';

    static Record = AdminUserRecord;

    /**
     * Secondary indexes required by this collection.
     * @type {Array<{name: string, jsonPath: string, unique: boolean}>}
     */
    static INDEXES = [
        { name: ADMIN_USER_EMAIL_ADDRESS_INDEX, jsonPath: '$.emailAddress', unique: true },
    ];

    /**
     * Generates a short random identifier for an administrator account.
     * @returns {string} A URL-safe 22-character Base62 identifier.
     */
    generateUniqueId() {
        return generateShortId();
    }

    /**
     * Orders administrator accounts by their creation timestamps.
     * @param {Object} doc - Prepared administrator document.
     * @returns {string|undefined} ISO creation timestamp, or undefined when absent.
     */
    generateSortKey(doc) {
        return doc?.userCreationDate;
    }

    /**
     * Creates an administrator account stamped with its creation time.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {Object} attributes - New admin user attributes.
     * @param {string[]} [attributes.roles=[]] - Role names granted to the new admin user.
     * @returns {Promise<AdminUserRecord>} The stored admin user record.
     * @throws {AssertionError} When the generated document id or attributes are invalid.
     * @throws {ValidationError} When the account attributes violate record invariants.
     * @throws {DocumentAlreadyExistsError} When the generated id already exists.
     * @throws {DocumentUniqueIndexViolationError} When the email address is already registered.
     */
    async createNewAdminUser(context, attributes) {
        const userCreationDate = new Date().toISOString();
        // Default missing roles to [] at this create-call boundary (not in
        // AdminUserRecord#validate()) so callers that do not yet assign a
        // role — and any future caller — get an empty-but-valid roles array
        // rather than a validation failure.
        const { roles = [] } = attributes ?? {};
        const attrs = Object.assign({}, attributes, { userCreationDate, roles });
        return await this.create(context, attrs);
    }

    /**
     * Retrieves an administrator account by its indexed email address.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} emailAddress - Exact normalized email address to match.
     * @returns {Promise<AdminUserRecord|null>} Matching account, or null when absent.
     * @throws {AssertionError} When the query arguments or index configuration are invalid.
     */
    async getByEmailAddress(context, emailAddress) {
        const { items } = await this.query(context, {
            index: ADMIN_USER_EMAIL_ADDRESS_INDEX,
            equalTo: emailAddress,
            limit: 1,
        });

        return items[0] ?? null;
    }
}
