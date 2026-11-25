/**
 * Publishing API request failure with protocol details for callers.
 */
export default class PublishingApiError extends Error {

    /**
     * @param {string} message - Operator-facing failure description
     * @param {Object} options - Request failure details
     * @param {?number} options.status - HTTP status, or null for a network failure
     * @param {Object[]} [options.errors] - JSON:API error objects
     * @param {string} options.method - HTTP method
     * @param {string} options.url - Request URL
     * @param {number} options.attempts - Number of attempts made
     * @param {Error} [options.cause] - Underlying network failure
     */
    constructor(message, options) {
        const {
            status,
            errors = [],
            method,
            url,
            attempts,
            cause,
        } = options ?? {};

        super(message, cause ? { cause } : undefined);

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: this.constructor.name,
            },
            code: {
                enumerable: true,
                value: this.constructor.name,
            },
            status: {
                enumerable: true,
                value: status,
            },
            errors: {
                enumerable: true,
                value: [ ...errors ],
            },
            method: {
                enumerable: true,
                value: method,
            },
            url: {
                enumerable: true,
                value: url,
            },
            attempts: {
                enumerable: true,
                value: attempts,
            },
        });
    }
}

/** Indicates that a requested build pointer does not exist. */
export class BuildNotFoundError extends PublishingApiError {}

/** Indicates that a requested Release does not exist. */
export class ReleaseNotFoundError extends PublishingApiError {}

/** Indicates that a build pointer changed after its precondition was read. */
export class BuildPointerConflictError extends PublishingApiError {}

/** Indicates that a build assignment failed protocol validation. */
export class InvalidBuildAssignmentError extends PublishingApiError {}

/** Indicates that a build assignment omitted its mandatory precondition. */
export class PreconditionRequiredError extends PublishingApiError {}

const ERROR_CLASSES = {
    BuildNotFound: BuildNotFoundError,
    ReleaseNotFound: ReleaseNotFoundError,
    BuildPointerConflict: BuildPointerConflictError,
    InvalidBuildAssignment: InvalidBuildAssignmentError,
    PreconditionRequired: PreconditionRequiredError,
};

/**
 * Creates the most specific Publishing API error represented by a response.
 * @param {string} message - Operator-facing failure description
 * @param {Object} options - Request failure details
 * @returns {PublishingApiError} Typed failure
 */
export function createPublishingApiError(message, options) {
    const apiCode = options?.errors?.find(({ code }) => code)?.code;
    const ErrorClass = ERROR_CLASSES[apiCode] ?? PublishingApiError;
    return new ErrorClass(message, options);
}
