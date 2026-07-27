import { isString, isUndefined } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isRoleName } from '../../../lib/roles.js';
import { normalizeOptionalStringAttribute } from '../utils.js';


export const DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MAX_PUBLISHING_API_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

// 'Editor' is the only publishing role today, so an omitted or empty roles
// submission defaults to it rather than requiring every JSON:API caller to
// spell it out. A live role picker is deferred until a second publishing
// role exists (see roles.js).
export const DEFAULT_PUBLISHING_API_TOKEN_ROLE = 'Editor';

const PUBLISHING_ROLE_CATEGORY = 'publishing';


/**
 * Normalizes and validates JSON:API token-creation attributes.
 *
 * This form only backs an API endpoint, so it intentionally omits the
 * HTML-form `target`, `method`, and `getFormContext()` machinery.
 */
export default class CreatePublishingApiTokenForm {

    /**
     * JSON Schema for accepted token-creation attributes.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            roles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Publishing role names for the minted token; defaults to ["Editor"] when omitted or empty.',
            },
            timeToLiveSeconds: {
                type: 'integer',
                minimum: 1,
                maximum: MAX_PUBLISHING_API_TOKEN_TTL_SECONDS,
                default: DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS,
                description: 'Optional token lifetime in seconds',
            },
            description: {
                type: [ 'string', 'null' ],
                description: 'Optional operator-facing description',
            },
        },
    };

    /**
     * @param {Object} [attributes] - JSON:API token-creation attributes.
     * @param {*} [attributes.roles] - Publishing role names for the minted token.
     * @param {*} [attributes.timeToLiveSeconds] - Optional token lifetime in seconds.
     * @param {*} [attributes.description] - Optional operator-facing description.
     */
    constructor(attributes) {
        const {
            roles,
            timeToLiveSeconds,
            description,
        } = attributes ?? {};

        this.roles = normalizeRoles(roles);
        this.timeToLiveSeconds = normalizeTimeToLiveSeconds(timeToLiveSeconds);
        this.description = normalizeOptionalStringAttribute(description);
    }

    /**
     * Validates the normalized token creation fields.
     * @returns {void}
     * @throws {ValidationError} When roles, TTL, or description are invalid.
     */
    validate() {
        const error = new ValidationError('The publishing API token form contains invalid fields');

        if (
            !Array.isArray(this.roles) ||
            this.roles.length === 0 ||
            !this.roles.every((name) => isRoleName(name, PUBLISHING_ROLE_CATEGORY))
        ) {
            error.push('Roles must be one or more registered publishing role names', 'roles');
        }

        if (!Number.isInteger(this.timeToLiveSeconds)) {
            error.push('Time to live must be an integer number of seconds', 'timeToLiveSeconds');
        } else if (this.timeToLiveSeconds <= 0) {
            error.push('Time to live must be greater than zero', 'timeToLiveSeconds');
        } else if (this.timeToLiveSeconds > MAX_PUBLISHING_API_TOKEN_TTL_SECONDS) {
            error.push(
                `Time to live must be no more than ${ MAX_PUBLISHING_API_TOKEN_TTL_SECONDS } seconds`,
                'timeToLiveSeconds',
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
     * Returns the normalized token-creation fields.
     * @returns {{ roles: string[], timeToLiveSeconds: number, description: string|null }} Plain JSON form values.
     */
    toJSON() {
        return {
            roles: this.roles,
            timeToLiveSeconds: this.timeToLiveSeconds,
            description: this.description,
        };
    }

    /**
     * Creates the form from a parsed JSON:API resource.
     * @param {{ attributes: Object }} resource - Parsed resource from parseJsonApiResource().
     * @returns {CreatePublishingApiTokenForm} Hydrated token-creation form.
     */
    static fromJsonApi(resource) {
        const { attributes } = resource ?? {};
        return new CreatePublishingApiTokenForm(attributes);
    }
}

function normalizeTimeToLiveSeconds(value) {
    if (value === null || isUndefined(value)) {
        return DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS;
    }

    return value;
}

function normalizeRoles(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return [ DEFAULT_PUBLISHING_API_TOKEN_ROLE ];
    }

    return value;
}
