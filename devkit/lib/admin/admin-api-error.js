/**
 * Admin API request failure with protocol details for callers.
 */
export default class AdminApiError extends Error {

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

/** Indicates a real run cannot restart an applied migration without `force`. */
export class MigrationAlreadyAppliedError extends AdminApiError {}

/** Indicates the stored ledger cursor is invalid; restart with `force`. */
export class MigrationCursorConflictError extends AdminApiError {}

/** Indicates another operator advanced the migration first; reload and retry without `force`. */
export class MigrationConcurrencyError extends AdminApiError {}

/** Indicates the submitted admin email or password was rejected. */
export class InvalidCredentialsError extends AdminApiError {}

/** Indicates the invite token is unknown, expired, revoked, or already used. */
export class InvalidInviteError extends AdminApiError {}

/** Indicates an admin already exists for the email; the invite was not consumed. */
export class NewUserConflictError extends AdminApiError {}

/** Indicates a concurrent signup claimed the email after the invite was consumed. */
export class InviteSpentInEmailRaceError extends AdminApiError {}

const ERROR_CLASSES = {
    MigrationAlreadyAppliedError,
    MigrationCursorConflictError,
    MigrationConcurrencyError,
    InvalidCredentials: InvalidCredentialsError,
    InvalidInvite: InvalidInviteError,
    NewUserConflictError,
    InviteSpentInEmailRace: InviteSpentInEmailRaceError,
};

/**
 * Creates the most specific Admin API error represented by a response.
 * @param {string} message - Operator-facing failure description
 * @param {Object} options - Request failure details
 * @returns {AdminApiError} Typed protocol failure
 */
export function createAdminApiError(message, options) {
    const apiCode = options?.errors?.find(({ code }) => code)?.code;
    const ErrorClass = ERROR_CLASSES[apiCode] ?? AdminApiError;
    return new ErrorClass(message, options);
}
