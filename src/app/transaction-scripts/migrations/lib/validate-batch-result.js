import {
    isNonEmptyString,
    isPlainObject,
} from '../../../../kixx/assertions/mod.js';


/**
 * Identifies a migration function return value that violates the batch contract.
 */
export class InvalidMigrationBatchResultError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidMigrationBatchResultError';
    }
}

/**
 * Validates a complete migration batch result before any progress is committed.
 * @param {*} result - Value returned by a migration function.
 * @param {string|null} inputCursor - Cursor supplied to that migration invocation.
 * @returns {{done: boolean, cursor: string|null, stats: Object}} The unchanged valid result.
 * @throws {InvalidMigrationBatchResultError} When the migration result violates its contract.
 */
export function validateBatchResult(result, inputCursor) {
    if (!isPlainObject(result)) {
        throwInvalidResult('result must be a plain object');
    }

    if (result.done !== true && result.done !== false) {
        throwInvalidResult('done must be a boolean');
    }

    if (result.done && result.cursor !== null) {
        throwInvalidResult('cursor must be null when done is true');
    }

    if (!result.done && !isNonEmptyString(result.cursor)) {
        throwInvalidResult('cursor must be a non-empty string when done is false');
    }

    if (!result.done && result.cursor === inputCursor) {
        throwInvalidResult('a non-terminal cursor must advance beyond its input cursor');
    }

    if (!isPlainObject(result.stats) || !Object.values(result.stats).every(Number.isFinite)) {
        throwInvalidResult('stats must be a plain object of finite numbers');
    }

    return result;
}

function throwInvalidResult(detail) {
    throw new InvalidMigrationBatchResultError(`Invalid migration batch result: ${ detail }`);
}
