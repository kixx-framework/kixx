import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString, isString } from '../../../../kixx/assertions/mod.js';
import BaseForm from '../base-form.js';
import { adminDataResources } from '../../../admin-data-api/mod.js';
import { ADMIN_DATA_ACTIONS } from '../../../permissions/admin-data-api.js';
import {
    normalizeIntegerStringAttribute,
    normalizeOptionalStringAttribute,
    normalizeStringAttribute,
} from '../utils.js';


const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

/**
 * Lifetime used when the create form omits one.
 * @type {number}
 */
export const DEFAULT_ADMIN_DATA_API_TOKEN_TTL_SECONDS = ONE_DAY_IN_SECONDS * 30;

/**
 * Longest lifetime a token may be minted with.
 * @type {number}
 */
export const MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS = ONE_DAY_IN_SECONDS * 365;

const MAX_DESCRIPTION_LENGTH = 200;
const TOKEN_ID_PATTERN = /^[0-9a-f]{64}$/u;

// The longest option equals the maximum so the bound is reachable from the UI.
const TIME_TO_LIVE_OPTIONS = [
    { value: ONE_DAY_IN_SECONDS * 7, label: '7 days' },
    { value: ONE_DAY_IN_SECONDS * 30, label: '30 days' },
    { value: ONE_DAY_IN_SECONDS * 90, label: '90 days' },
    { value: MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS, label: '365 days' },
];

// Each grant checkbox submits "<Collection>:<action>", e.g. "File:list".
const GRANT_SEPARATOR = ':';


/**
 * Backs the "create token" control in the Administrative Data API token management UI.
 *
 * Grant choices come from the current resource registry, and submitted
 * grants are re-validated against it, so a forged or stale submission can
 * never mint access to an unregistered Collection or a disabled operation.
 * @extends BaseForm
 */
export default class AdminDataApiTokenCreateForm extends BaseForm {

    /**
     * HttpTarget name used to compile the create-token action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/admin-data-api-tokens/create-token';

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
                maxLength: MAX_DESCRIPTION_LENGTH,
            },
            grants: {
                type: 'array',
                items: { type: 'string' },
                fieldType: 'checkbox-group',
                label: 'Access',
                hint: 'Choose exactly what this token may do. Grants cannot be changed later.',
            },
            time_to_live_seconds: {
                type: 'integer',
                fieldType: 'select',
                label: 'Expires after',
                default: DEFAULT_ADMIN_DATA_API_TOKEN_TTL_SECONDS,
                options: TIME_TO_LIVE_OPTIONS,
            },
        },
        required: [ 'grants' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted token-creation attributes.
     * @param {*} [attributes.description] - Operator-facing token description.
     * @param {*} [attributes.grants] - Selected "<Collection>:<action>" values; a string or an array.
     * @param {*} [attributes.time_to_live_seconds] - Selected token lifetime in seconds.
     */
    constructor(attributes) {
        super();

        const { description, grants, time_to_live_seconds } = attributes ?? {};

        this.description = normalizeOptionalStringAttribute(description);
        this.grants = normalizeGrantValues(grants);
        this.time_to_live_seconds = normalizeIntegerStringAttribute(
            time_to_live_seconds,
            DEFAULT_ADMIN_DATA_API_TOKEN_TTL_SECONDS,
        );
    }

    /**
     * Reads every checked grant checkbox, since FormData repeats the field name.
     * @param {FormData} formData - Submitted browser form data.
     * @returns {AdminDataApiTokenCreateForm} Hydrated form.
     */
    static fromFormData(formData) {
        return new AdminDataApiTokenCreateForm({
            description: formData.get('description'),
            grants: formData.getAll('grants'),
            time_to_live_seconds: formData.get('time_to_live_seconds'),
        });
    }

    /**
     * Supplies grant choices from the current resource registry, grouped by
     * resource, with each option marked when it is currently selected.
     * @param {import('../../../../kixx/context/request-context.js').default} _context - Current request context.
     * @returns {{ grants: { resources: Object[] } }} Dynamic metadata for the grants field.
     */
    getDynamicFieldMetadata(_context) {
        const selected = new Set(this.grants);

        const resources = adminDataResources.listResources().map((resource) => {
            const actions = ADMIN_DATA_ACTIONS
                .filter((action) => adminDataResources.isOperationEnabled(resource.type, action))
                .map((action) => {
                    const value = `${ resource.collection }${ GRANT_SEPARATOR }${ action }`;
                    return { value, action, isChecked: selected.has(value) };
                });

            return {
                type: resource.type,
                collection: resource.collection,
                description: resource.description,
                actions,
            };
        });

        return { grants: { resources } };
    }

    /**
     * Validates the normalized token creation fields against the current registry.
     * @returns {void}
     * @throws {ValidationError} When grants, TTL, or description are invalid.
     */
    validate() {
        const error = new ValidationError('The admin data API token form contains invalid fields');

        if (!Array.isArray(this.grants) || this.grants.length === 0) {
            error.push('Choose at least one permission', 'grants');
        } else if (!this.grants.every(isAvailableGrantValue)) {
            error.push('One or more selected permissions are not available', 'grants');
        }

        if (!Number.isInteger(this.time_to_live_seconds)) {
            error.push('Expiration must be a whole number of seconds', 'time_to_live_seconds');
        } else if (this.time_to_live_seconds <= 0) {
            error.push('Expiration must be greater than zero', 'time_to_live_seconds');
        } else if (this.time_to_live_seconds > MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS) {
            error.push(
                `Expiration must be no more than ${ MAX_ADMIN_DATA_API_TOKEN_TTL_SECONDS } seconds`,
                'time_to_live_seconds',
            );
        }

        if (this.description !== null &&
            (!isString(this.description) || this.description.length > MAX_DESCRIPTION_LENGTH)) {
            error.push(`Description must be at most ${ MAX_DESCRIPTION_LENGTH } characters`, 'description');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the fields consumed by createAdminDataApiToken(). Call only after validate().
     * @returns {{ grants: Object[], description: string|null, timeToLiveSeconds: number }} Plain JSON form values.
     */
    toJSON() {
        const actionsByCollection = new Map();

        for (const value of this.grants) {
            const [ collection, action ] = value.split(GRANT_SEPARATOR);

            if (!actionsByCollection.has(collection)) {
                actionsByCollection.set(collection, []);
            }
            actionsByCollection.get(collection).push(action);
        }

        return {
            grants: Array.from(actionsByCollection, ([ collection, actions ]) => ({ collection, actions })),
            description: this.description,
            timeToLiveSeconds: this.time_to_live_seconds,
        };
    }
}

function normalizeGrantValues(value) {
    let values;
    if (Array.isArray(value)) {
        values = value;
    } else if (isNonEmptyString(value)) {
        values = [ value ];
    } else {
        return [];
    }

    // Keep non-strings so validate() reports them instead of silently
    // narrowing what the operator asked for; collapse exact duplicates.
    return Array.from(new Set(values.map((item) => (isString(item) ? item.trim() : item))));
}

function isAvailableGrantValue(value) {
    if (!isString(value)) {
        return false;
    }

    const parts = value.split(GRANT_SEPARATOR);
    if (parts.length !== 2) {
        return false;
    }

    const resource = adminDataResources.getResourceByCollection(parts[0]);
    return Boolean(resource) && adminDataResources.isOperationEnabled(resource.type, parts[1]);
}


/**
 * Backs the per-row "revoke" control in the Administrative Data API token management UI.
 *
 * The action URL is shared across rows; each rendered form supplies the target
 * token id as a hidden field so a single submission revokes one token.
 * @extends BaseForm
 */
export class AdminDataApiTokenRevokeForm extends BaseForm {

    /**
     * HttpTarget name used to compile the revoke-token action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/admin-data-api-tokens-revoke/revoke';

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
            token_id: { type: 'string', fieldType: 'hidden', pattern: TOKEN_ID_PATTERN.source },
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
     * Validates that the submitted id has the stored SHA-256 hash shape.
     * @returns {void}
     * @throws {ValidationError} When the token id is missing or malformed.
     */
    validate() {
        const error = new ValidationError('The revoke token request is invalid');

        if (!isNonEmptyString(this.token_id)) {
            error.push('Token id is required', 'token_id');
        } else if (!TOKEN_ID_PATTERN.test(this.token_id)) {
            // Validate untrusted ids before storage, which treats control
            // characters as an internal invariant violation.
            error.push('Token id must be a 64-character lowercase hexadecimal hash', 'token_id');
        }

        if (error.length) {
            throw error;
        }
    }
}
