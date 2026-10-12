import { assert, assertNonEmptyString, isUndefined } from '../../../kixx/assertions/mod.js';
import { AssertionError, BadRequestError } from '../../../kixx/errors/mod.js';
import { MAX_PAGE_SIZE } from '../../admin-data-api/resource-registry.js';
import { authorizeAdminDataAction, projectRecord } from './lib.js';


/**
 * Lists one page of records using only a query plan the registration declares.
 *
 * A declared sort with an `index` runs a secondary index query; otherwise the
 * Collection's primary sort key is scanned. No other ordering, filter, or
 * index can be selected.
 *
 * @param {import('../../../kixx/context/request-context.js').default} context - Request context carrying the token principal.
 * @param {string} type - Public JSON:API resource type.
 * @param {Object} options - Validated list options.
 * @param {string} options.sort - One of the registration's declared sort names.
 * @param {number} options.limit - Page size, 1 to MAX_PAGE_SIZE.
 * @param {string} [options.cursor] - Signed cursor from a previous page.
 * @returns {Promise<{ items: import('./lib.js').AdminDataRecord[], cursor: string|null }>} Projected page and the next cursor, or null on the last page.
 * @throws {NotFoundError} When the type is not registered.
 * @throws {MethodNotAllowedError} When the registration does not enable `list`.
 * @throws {ForbiddenError} When the token is not granted `list` on the Collection.
 * @throws {BadRequestError} With code `AdminDataInvalidCursor` when the cursor is forged, tampered with, or from another sort.
 */
export async function listAdminDataRecords(context, type, options) {
    const { sort: sortName, limit, cursor } = options ?? {};

    const resource = authorizeAdminDataAction(context, type, 'list');

    const sort = resource.operations.list.sorts.find(({ name }) => name === sortName);
    assert(sort, `listAdminDataRecords: '${ sortName }' is not a declared sort`);
    assert(
        Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_PAGE_SIZE,
        'listAdminDataRecords: limit must be an integer from 1 to MAX_PAGE_SIZE',
    );
    if (!isUndefined(cursor)) {
        assertNonEmptyString(cursor, 'listAdminDataRecords: cursor');
    }

    const collection = context.getCollection(resource.collection);
    const queryOptions = { descending: sort.descending, limit, cursor };

    let page;
    try {
        page = sort.index
            ? await collection.query(context, Object.assign({ index: sort.index }, queryOptions))
            : await collection.scan(context, queryOptions);
    } catch (cause) {
        // The store binds each cursor to the ordering that produced it, so a
        // cursor replayed under another sort fails here just like a forged one.
        if (cause.name === 'InvalidCursorError') {
            throw new BadRequestError('The page cursor is invalid.', { cause, code: 'AdminDataInvalidCursor' });
        }
        throw new AssertionError('Unexpected error while listing admin data records', { cause });
    }

    return {
        items: page.items.map((record) => projectRecord(resource, record)),
        cursor: page.cursor ?? null,
    };
}
