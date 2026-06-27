import { isString } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { validatePermissions } from '../../../lib/publishing-permissions.js';


export const DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MAX_PUBLISHING_API_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;


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
            permissions: {
                type: 'array',
                minItems: 1,
                description: 'Permission grants for the minted token',
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
        required: [ 'permissions' ],
    };

    /**
     * @param {Object} [attributes] - JSON:API token-creation attributes.
     * @param {*} [attributes.permissions] - Permission grants for the minted token.
     * @param {*} [attributes.timeToLiveSeconds] - Optional token lifetime in seconds.
     * @param {*} [attributes.description] - Optional operator-facing description.
     */
    constructor(attributes) {
        const {
            permissions,
            timeToLiveSeconds,
            description,
        } = attributes ?? {};

        this.permissions = permissions;
        this.timeToLiveSeconds = normalizeTimeToLiveSeconds(timeToLiveSeconds);
        this.description = normalizeOptionalDescription(description);
    }

    /**
     * Validates the normalized token creation fields.
     * @returns {void}
     * @throws {ValidationError} When permissions, TTL, or description are invalid.
     */
    validate() {
        const error = new ValidationError('The publishing API token form contains invalid fields');

        try {
            validatePermissions(this.permissions);
        } catch (cause) {
            if (cause.name !== 'ValidationError') {
                throw cause;
            }

            for (const fieldError of cause.errors) {
                error.push(fieldError.message, fieldError.source);
            }
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
     * @returns {{ permissions: *, timeToLiveSeconds: number, description: string|null }} Plain JSON form values.
     */
    toJSON() {
        return {
            permissions: this.permissions,
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
    if (value === null || value === undefined) {
        return DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS;
    }

    return value;
}

function normalizeOptionalDescription(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (!isString(value)) {
        return value;
    }

    const description = value.trim();
    return description.length > 0 ? description : null;
}
