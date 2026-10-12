import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { listAttachableRoles } from '../../../permissions/roles.js';
import { normalizeStringAttribute } from '../utils.js';


const ADMIN_ROLE_CATEGORY = 'admin';


/**
 * Backs the "create invite" control in the admin invite management UI.
 *
 * The owner is taken from the authenticated session, so the only operator
 * input is the role to confer. Checking that the submitted id is attachable is
 * not this form's job: it is a security decision owned by
 * `createAdminInvite()`, which fails closed with a 403 (not a 422 field
 * error) on anything the rendered options should never have offered. This
 * form's own `validate()` only enforces that a selection was made.
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
     * JSON Schema for the single role selection.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            role_id: { type: 'string', fieldType: 'select' },
        },
        required: [ 'role_id' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted invite attributes.
     * @param {*} [attributes.role_id] - Selected role id to confer.
     */
    constructor(attributes) {
        super();

        const { role_id } = attributes ?? {};
        this.role_id = normalizeStringAttribute(role_id);
    }

    /**
     * Validates that a role selection was submitted. Whether the selection is
     * attachable is checked by `createAdminInvite()`, not here.
     * @returns {void}
     * @throws {ValidationError} When no role was selected.
     */
    validate() {
        const error = new ValidationError('The create invite request is invalid');

        if (!isNonEmptyString(this.role_id)) {
            error.push('A role selection is required', 'role_id');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Fills the `role_id` field's options with every role attachable to an
     * invite. The options are not filtered per user: any admin who passes the
     * invite-write authorization gate may confer any of them. Roles are read
     * from the registry rather than duplicated as a static schema enum, so the
     * rendered choices and what `createAdminInvite()` will accept cannot drift
     * apart. Root Admin carries no category, so it is absent here for the same
     * reason it is refused there.
     * @returns {Object<string, Object>} Partial field metadata keyed by field name.
     */
    getDynamicFieldMetadata() {
        const options = listAttachableRoles(ADMIN_ROLE_CATEGORY)
            .map((role) => ({ value: role.id, label: role.name }));

        return {
            role_id: {
                label: 'Role',
                options,
            },
        };
    }
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
