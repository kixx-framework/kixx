import { isString } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import BaseForm from '../base-form.js';
import {
    normalizeStringAttribute,
    normalizeLowerCaseStringAttribute,
    validateEmailAddressField,
} from '../utils.js';


/**
 * Normalizes and validates the admin-user login fields.
 * @extends BaseForm
 */
export default class AdminUserLoginForm extends BaseForm {

    /**
     * HttpTarget name used to compile the login form action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-login-form/post-form';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for accepted login fields, extended with HTML render metadata.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            email_address: {
                type: 'string',
                format: 'email',
                label: 'Email address',
                // `inputType` drives the rendered <input type>; kept distinct from
                // `fieldType` so the template can choose a control independently.
                inputType: 'email',
                autocomplete: 'email',
                hint: 'The email address for your admin account.',
            },
            password: {
                type: 'string',
                minLength: 16,
                maxLength: 256,
                // writeOnly keeps the submitted password from being echoed back into
                // the re-rendered form on a validation error (see BaseForm#getFormContext).
                writeOnly: true,
                label: 'Password',
                inputType: 'password',
                // current-password (not new-password) so password managers offer the
                // saved credential for this account rather than generating a new one.
                autocomplete: 'current-password',
                hint: 'Enter your account password.',
            },
        },
        required: [ 'email_address', 'password' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted login attributes.
     * @param {*} [attributes.email_address] - Email address input value.
     * @param {*} [attributes.password] - Password input value.
     */
    constructor(attributes) {
        super();

        const {
            email_address,
            password,
        } = attributes ?? {};

        this.email_address = normalizeLowerCaseStringAttribute(email_address);
        this.password = normalizeStringAttribute(password);
    }

    /**
     * Validates the normalized login fields.
     * @returns {void}
     * @throws {ValidationError} When the email address or password is missing or invalid.
     */
    validate() {
        const error = new ValidationError('The login form contains invalid fields');
        const {
            minLength: passwordMinLength,
            maxLength: passwordMaxLength,
        } = this.constructor.schema.properties.password;

        validateEmailAddressField(error, this.email_address, 'email_address');

        if (!isString(this.password) || this.password.length === 0) {
            error.push('Password is required', 'password');
        } else if (this.password.length < passwordMinLength) {
            error.push(`Password must be at least ${ passwordMinLength } characters`, 'password');
        } else if (this.password.length > passwordMaxLength) {
            error.push(`Password must be no more than ${ passwordMaxLength } characters`, 'password');
        }

        if (error.length) {
            throw error;
        }
    }
}
