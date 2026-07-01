import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString, isString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { normalizeOptionalStringAttribute, normalizeStringAttribute } from '../utils.js';
import { ALLOW_ALL_PUBLISHING_PERMISSIONS } from '../../../lib/publishing-permissions.js';
import {
    DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS,
    MAX_PUBLISHING_API_TOKEN_TTL_SECONDS,
} from './create-publishing-api-token-form.js';


const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const INTEGER_STRING_PATTERN = /^[0-9]+$/u;

// Common lifetime choices for the admin panel select control. The longest
// option matches MAX_PUBLISHING_API_TOKEN_TTL_SECONDS exactly (365 days) so
// the upper bound is reachable through the UI, not just the JSON:API form.
const TIME_TO_LIVE_OPTIONS = [
    { value: ONE_DAY_IN_SECONDS * 7, label: '7 days' },
    { value: ONE_DAY_IN_SECONDS * 30, label: '30 days' },
    { value: ONE_DAY_IN_SECONDS * 90, label: '90 days' },
    { value: ONE_DAY_IN_SECONDS * 365, label: '365 days' },
];


/**
 * Backs the "create token" control in the Publishing API token management UI.
 *
 * Every admin-panel-created token uses the existing wildcard allow-all grant —
 * the only grant shape `validatePermissions()` currently accepts — so this form
 * exposes no permissions field, only an operator description and a bounded TTL.
 * @extends BaseForm
 */
export default class PublishingApiTokenCreateForm extends BaseForm {

    /**
     * HttpTarget name used to compile the create-token action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/publishing-api-tokens/create-token';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for accepted token-creation fields.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            description: {
                type: [ 'string', 'null' ],
                fieldType: 'text',
                label: 'Description',
                hint: 'Optional note to identify this token later.',
            },
            time_to_live_seconds: {
                type: 'integer',
                fieldType: 'select',
                label: 'Expires after',
                default: DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS,
                options: TIME_TO_LIVE_OPTIONS,
            },
        },
    };

    /**
     * @param {Object} [attributes] - Raw submitted token-creation attributes.
     * @param {*} [attributes.description] - Operator-facing token description.
     * @param {*} [attributes.time_to_live_seconds] - Selected token lifetime in seconds.
     */
    constructor(attributes) {
        super();

        const { description, time_to_live_seconds } = attributes ?? {};

        this.description = normalizeOptionalStringAttribute(description);
        this.time_to_live_seconds = normalizeTimeToLiveSeconds(time_to_live_seconds);
    }

    /**
     * Validates the normalized token creation fields.
     * @returns {void}
     * @throws {ValidationError} When the TTL or description are invalid.
     */
    validate() {
        const error = new ValidationError('The publishing API token form contains invalid fields');

        if (!Number.isInteger(this.time_to_live_seconds)) {
            error.push('Expiration must be a whole number of seconds', 'time_to_live_seconds');
        } else if (this.time_to_live_seconds <= 0) {
            error.push('Expiration must be greater than zero', 'time_to_live_seconds');
        } else if (this.time_to_live_seconds > MAX_PUBLISHING_API_TOKEN_TTL_SECONDS) {
            error.push(
                `Expiration must be no more than ${ MAX_PUBLISHING_API_TOKEN_TTL_SECONDS } seconds`,
                'time_to_live_seconds',
            );
        }

        if (this.description !== null && !isString(this.description)) {
            error.push('Description must be a string or null', 'description');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the fields consumed by createPublishingApiToken(), always granting the
     * allow-all permission set since the admin panel exposes no permissions field.
     * @returns {{ permissions: Object[], description: string|null, timeToLiveSeconds: number }} Plain JSON form values.
     */
    toJSON() {
        return {
            permissions: ALLOW_ALL_PUBLISHING_PERMISSIONS,
            description: this.description,
            timeToLiveSeconds: this.time_to_live_seconds,
        };
    }
}

function normalizeTimeToLiveSeconds(value) {
    if (value === null || value === undefined) {
        return DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS;
    }

    if (!isString(value)) {
        return value;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS;
    }

    // Number.parseInt() accepts partial numbers like "604800abc"; keep forged
    // non-integer submissions invalid so validate() can report the field error.
    if (!INTEGER_STRING_PATTERN.test(trimmed)) {
        return Number.NaN;
    }

    return Number.parseInt(trimmed, 10);
}


/**
 * Backs the per-row "revoke" control in the Publishing API token management UI.
 *
 * The action URL is shared across rows; each rendered form supplies the target
 * token id as a hidden field so a single submission revokes one token.
 * @extends BaseForm
 */
export class PublishingApiTokenRevokeForm extends BaseForm {

    /**
     * HttpTarget name used to compile the revoke-token action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/publishing-api-tokens-revoke/revoke';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for the revoke request: a single hidden token id.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            token_id: { type: 'string', fieldType: 'hidden' },
        },
        required: [ 'token_id' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted revoke attributes.
     * @param {*} [attributes.token_id] - Token record id (token hash) to revoke.
     */
    constructor(attributes) {
        super();

        const { token_id } = attributes ?? {};
        this.token_id = normalizeStringAttribute(token_id);
    }

    /**
     * Validates that a token id was submitted.
     * @returns {void}
     * @throws {ValidationError} When the token id is missing.
     */
    validate() {
        const error = new ValidationError('The revoke token request is invalid');

        if (!isNonEmptyString(this.token_id)) {
            error.push('Token id is required', 'token_id');
        }

        if (error.length) {
            throw error;
        }
    }
}
