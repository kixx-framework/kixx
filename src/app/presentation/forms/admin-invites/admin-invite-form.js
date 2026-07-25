import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { filterGrantableRoles } from '../../../lib/roles.js';
import { normalizeStringAttribute } from '../utils.js';


const ADMIN_ROLE_CATEGORY = 'admin';


/**
 * Backs the "create invite" control in the admin invite management UI.
 *
 * The owner is taken from the authenticated session, so the only operator
 * input is the single role to confer. Registered-name and delegation
 * checking are not this form's job: they are a security decision owned by
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
     * JSON Schema for the single grantable-role selection.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            role: { type: 'string', fieldType: 'select' },
        },
        required: [ 'role' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted invite attributes.
     * @param {*} [attributes.role] - Selected admin role name to confer.
     */
    constructor(attributes) {
        super();

        const { role } = attributes ?? {};
        this.role = normalizeStringAttribute(role);
    }

    /**
     * Validates that a role selection was submitted. Whether the selection is
     * a registered, grantable role is checked by `createAdminInvite()`, not here.
     * @returns {void}
     * @throws {ValidationError} When no role was selected.
     */
    validate() {
        const error = new ValidationError('The create invite request is invalid');

        if (!isNonEmptyString(this.role)) {
            error.push('A role selection is required', 'role');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Builds the form render context, filling the `role` field's options with
     * the roles the signed-in admin may grant. Computed fresh per request from
     * `context.user.permissions` (never a static schema enum) so a surface
     * never offers a role the signed-in principal cannot grant; server-side
     * enforcement in `createAdminInvite()` remains the actual guard.
     * @param {import('../../../../kixx/context/request-context.js').default} context - Current request context.
     * @param {import('../../../../kixx/errors/lib/validation-error.js').default|string|null} [error] -
     * ValidationError from validate(), domain error code string, or null.
     * @returns {import('../base-form.js').FormRenderContext} Form context for template rendering.
     */
    getFormContext(context, error) {
        const formContext = super.getFormContext(context, error);
        const options = filterGrantableRoles(context.user?.permissions, ADMIN_ROLE_CATEGORY)
            .map((role) => ({ value: role.name, label: role.name }));

        formContext.fields.role = Object.assign({}, formContext.fields.role, {
            label: 'Role',
            options,
        });

        return formContext;
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
