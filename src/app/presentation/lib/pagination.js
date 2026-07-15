import { isNonEmptyString, isString, isUndefined } from '../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../kixx/errors/mod.js';

// Query-string cardinality and invite-history structure are HTTP concerns.
// DocumentStore separately verifies the signed cursor token after this module
// passes one validated cursor value to the transaction script.

/**
 * Reads and validates the `cursor` query parameter for a paginated list page.
 * @param {Object} queryParams - Parsed request query parameters
 * @returns {string|undefined} The cursor value, or undefined when absent
 * @throws {BadRequestError} When cursor is present but is not a single non-empty value
 */
export function getCursorQueryParam(queryParams) {
    const { cursor } = queryParams;

    if (isUndefined(cursor)) {
        return undefined;
    }

    // request.queryParams collapses "?cursor=" to an empty string and promotes
    // repeated "?cursor=a&cursor=b" keys to an array; both are malformed client
    // input rather than a valid opaque cursor token, so reject them as a 400
    // instead of letting the document store's internal assertion crash the process.
    if (!isNonEmptyString(cursor)) {
        throw new BadRequestError('The cursor query parameter must be a single non-empty value.');
    }

    return cursor;
}

/**
 * Reads and validates the `history` query parameters used for invite-list
 * previous-page navigation.
 *
 * The first empty value is the explicit page-one sentinel; every later value
 * must be a non-empty signed cursor.
 * @param {Object} queryParams - Parsed request query parameters.
 * @returns {string[]} Validated ancestor cursor stack, oldest first.
 * @throws {BadRequestError} When history has an invalid shape or cursor value.
 */
export function getInviteListHistoryQueryParam(queryParams) {
    const { history } = queryParams;

    if (isUndefined(history)) {
        return [];
    }

    const cursors = Array.isArray(history) ? history : [ history ];
    for (let i = 0; i < cursors.length; i += 1) {
        const cursor = cursors[i];
        const isPageOneSentinel = i === 0 && cursor === '';
        if (!isPageOneSentinel && !isNonEmptyString(cursor)) {
            throw new BadRequestError('The history query parameters must be valid cursor values.');
        }

        if (!isString(cursor)) {
            throw new BadRequestError('The history query parameters must be valid cursor values.');
        }
    }

    return cursors;
}

/**
 * Converts a rejected signed cursor into a client-safe malformed-query error.
 * @param {Error} cause - Error thrown while loading a paginated result.
 * @throws {BadRequestError} When cause is an InvalidCursorError.
 * @throws {Error} Rethrows unrelated errors unchanged.
 */
export function rethrowInvalidCursorAsBadRequest(cause) {
    if (cause.name === 'InvalidCursorError') {
        throw new BadRequestError('The cursor query parameter is invalid.', { cause });
    }

    throw cause;
}
