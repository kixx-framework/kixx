import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { listRolePresets } from '../../../lib/roles.js';
import { normalizeStringAttribute } from '../utils.js';


/**
 * Backs the "create invite" control in the admin invite management UI.
 *
 * The owner is taken from the authenticated session, so the only operator
 * input is the role preset to confer. Checking that the submitted name is a
 * registered preset is not this form's job: it is a security decision owned by
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
     * JSON Schema for the single role preset selection.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            role_preset: { type: 'string', fieldType: 'select' },
        },
        required: [ 'role_preset' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted invite attributes.
     * @param {*} [attributes.role_preset] - Selected role preset name to confer.
     */
    constructor(attributes) {
        super();

        const { role_preset } = attributes ?? {};
        this.role_preset = normalizeStringAttribute(role_preset);
    }

    /**
     * Validates that a preset selection was submitted. Whether the selection is
     * a registered preset is checked by `createAdminInvite()`, not here.
     * @returns {void}
     * @throws {ValidationError} When no role preset was selected.
     */
    validate() {
        const error = new ValidationError('The create invite request is invalid');

        if (!isNonEmptyString(this.role_preset)) {
            error.push('A role preset selection is required', 'role_preset');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Builds the form render context, filling the `role_preset` field's options
     * with every registered role preset. The options are not filtered per user:
     * any admin who passes the invite-write authorization gate may confer any
     * preset. Presets are read from the registry rather than duplicated as a
     * static schema enum, so the rendered choices and what
     * `createAdminInvite()` will accept cannot drift apart.
     * @param {import('../../../../kixx/context/request-context.js').default} context - Current request context.
     * @param {import('../../../../kixx/errors/lib/validation-error.js').default|string|null} [error] -
     * ValidationError from validate(), domain error code string, or null.
     * @returns {import('../base-form.js').FormRenderContext} Form context for template rendering.
     */
    getFormContext(context, error) {
        const formContext = super.getFormContext(context, error);
        const options = listRolePresets().map((preset) => ({ value: preset.name, label: preset.name }));

        formContext.fields.role_preset = Object.assign({}, formContext.fields.role_preset, {
            label: 'Role preset',
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
