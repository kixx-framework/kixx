import { isNonEmptyString, isUndefined } from '../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../kixx/errors/mod.js';

// Query-string cardinality and cursor-history structure are HTTP concerns.
// DocumentStore separately verifies the signed cursor token after this module
// passes one validated cursor value to the transaction script.

function getCursorQueryParam(queryParams) {
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

function getCursorHistoryQueryParam(queryParams) {
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
    }

    return cursors;
}

function createCursorPaginationLink(pathname, cursor, history) {
    const url = new URL(pathname, 'http://localhost');

    if (cursor) {
        url.searchParams.set('cursor', cursor);
    }

    for (const ancestorCursor of history) {
        url.searchParams.append('history', ancestorCursor);
    }

    return `${ url.pathname }${ url.search }`;
}

/**
 * Reads the current cursor and ancestor cursor history for a paginated list.
 *
 * History is ordered oldest first. An empty first value represents page one;
 * every other history value must be a non-empty cursor.
 * @param {Object} queryParams - Parsed request query parameters
 * @returns {{ cursor: string|undefined, history: string[] }} Validated cursor pagination state
 * @throws {BadRequestError} When cursor or history has an invalid shape or value
 */
export function getCursorPaginationQueryParams(queryParams) {
    return {
        cursor: getCursorQueryParam(queryParams),
        history: getCursorHistoryQueryParam(queryParams),
    };
}

/**
 * Builds forward and backward links for a forward-only cursor-paginated list.
 * @param {Object} args - Pagination link arguments
 * @param {string} args.pathname - Reverse-compiled pathname for the list route
 * @param {string} [args.cursor] - Cursor used to load the current page
 * @param {string[]} [args.history] - Ancestor cursor stack, oldest first
 * @param {string|null} args.nextCursor - Cursor returned for the next page, or null
 * @returns {{ nextPage?: string, previousPage?: string }} Available pagination links
 */
export function createCursorPaginationLinks(args) {
    const {
        pathname,
        cursor,
        history = [],
        nextCursor,
    } = args ?? {};
    const links = {};

    if (nextCursor) {
        links.nextPage = createCursorPaginationLink(
            pathname,
            nextCursor,
            [ ...history, cursor ?? '' ],
        );
    }

    if (history.length) {
        const previousCursor = history[history.length - 1];
        links.previousPage = createCursorPaginationLink(
            pathname,
            previousCursor || undefined,
            history.slice(0, -1),
        );
    }

    return links;
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
