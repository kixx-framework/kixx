import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { normalizeStringAttribute } from '../utils.js';


/**
 * Backs the "create invite" control in the admin invite management UI.
 *
 * Minting needs no operator-entered fields — the token is generated server-side
 * and the owner is taken from the authenticated session — so this form exists only
 * to carry the CSRF token and compile the reverse-routed action URL.
 * @extends BaseForm
 */
export default class AdminInviteCreateForm extends BaseForm {

    /**
     * HttpTarget name used to compile the create-invite action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/invites/create-invite';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema with no input fields; minting takes no user-entered data.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {},
    };
}


/**
 * Backs the per-row "revoke" control in the admin invite management UI.
 *
 * The action URL is shared across rows; each rendered form supplies the target
 * invite id as a hidden field so a single submission revokes one invite.
 * @extends BaseForm
 */
export class AdminInviteRevokeForm extends BaseForm {

    /**
     * HttpTarget name used to compile the revoke-invite action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/invites-revoke/revoke';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for the revoke request: a single hidden invite id.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            invite_id: { type: 'string', fieldType: 'hidden' },
        },
        required: [ 'invite_id' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted revoke attributes.
     * @param {*} [attributes.invite_id] - Invite record id (token hash) to revoke.
     */
    constructor(attributes) {
        super();

        const { invite_id } = attributes ?? {};
        this.invite_id = normalizeStringAttribute(invite_id);
    }

    /**
     * Validates that an invite id was submitted.
     * @returns {void}
     * @throws {ValidationError} When the invite id is missing.
     */
    validate() {
        const error = new ValidationError('The revoke invite request is invalid');

        if (!isNonEmptyString(this.invite_id)) {
            error.push('Invite id is required', 'invite_id');
        }

        if (error.length) {
            throw error;
        }
    }
}
