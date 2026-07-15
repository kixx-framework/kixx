import { isNonEmptyString, isUndefined } from '../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../kixx/errors/mod.js';


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
