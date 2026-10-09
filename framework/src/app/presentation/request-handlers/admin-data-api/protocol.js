import { isNonEmptyString, isUndefined } from '../../../../kixx/assertions/mod.js';
import { BadRequestError } from '../../../../kixx/errors/mod.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../admin-data-api/resource-registry.js';
import { withErrorSource } from '../../lib/json-api.js';


/**
 * Fully-qualified name of the target serving one resource, used to compile
 * `links.self` and `Location` URLs.
 * @type {string}
 */
export const RESOURCE_TARGET_NAME = 'admin-data-api/resource/dispatch';

/**
 * Fully-qualified name of the target serving a resource collection, used to
 * compile pagination links.
 * @type {string}
 */
export const COLLECTION_TARGET_NAME = 'admin-data-api/collection/dispatch';

/**
 * Header carrying the observed version on DELETE, which has no body.
 * @type {string}
 */
export const EXPECTED_VERSION_HEADER = 'Kixx-Expected-Version';

const SORT_PARAMETER = 'sort';
const PAGE_SIZE_PARAMETER = 'page[size]';
const PAGE_AFTER_PARAMETER = 'page[after]';

/**
 * Rejects every query parameter, for endpoints that accept none.
 * @param {Object} request - Incoming request.
 * @returns {void}
 * @throws {BadRequestError} With `source.parameter` naming the first parameter.
 */
export function assertNoQueryParameters(request) {
    readQueryParameters(request, []);
}

/**
 * Reads the sparse fieldset for a single-resource response; no other query
 * parameter is accepted.
 * @param {Object} request - Incoming request.
 * @param {Object} resource - Frozen resource registration.
 * @returns {string[]|null} Requested attribute names, or null for all declared attributes.
 * @throws {BadRequestError} When a parameter is unknown, repeated, or names an undeclared attribute.
 */
export function parseFieldsQuery(request, resource) {
    const fieldsParameter = fieldsParameterName(resource);
    const params = readQueryParameters(request, [ fieldsParameter ]);

    return parseFieldset(params[fieldsParameter], resource, fieldsParameter);
}

/**
 * Reads list query parameters against the registration's declared query plans.
 * @param {Object} request - Incoming request.
 * @param {Object} resource - Frozen resource registration enabling `list`.
 * @returns {{ sort: string, limit: number, cursor: string|undefined, fields: string[]|null, preserved: Object<string, string> }}
 *   Validated options; `preserved` holds the parameters, other than the cursor, that a next-page link must repeat.
 * @throws {BadRequestError} When a parameter is unknown, repeated, or invalid; `source.parameter` names it.
 */
export function parseListQuery(request, resource) {
    const fieldsParameter = fieldsParameterName(resource);
    const params = readQueryParameters(request, [
        SORT_PARAMETER,
        PAGE_SIZE_PARAMETER,
        PAGE_AFTER_PARAMETER,
        fieldsParameter,
    ]);

    const { sorts } = resource.operations.list;
    let sort = sorts[0].name;

    if (!isUndefined(params[SORT_PARAMETER])) {
        sort = params[SORT_PARAMETER];

        if (!sorts.some(({ name }) => name === sort)) {
            throw invalidParameter(`sort must be one of: ${ sorts.map(({ name }) => name).join(', ') }.`, SORT_PARAMETER);
        }
    }

    let limit = DEFAULT_PAGE_SIZE;

    if (!isUndefined(params[PAGE_SIZE_PARAMETER])) {
        const value = params[PAGE_SIZE_PARAMETER];
        limit = Number(value);

        if (!/^[1-9][0-9]*$/.test(value) || limit > MAX_PAGE_SIZE) {
            throw invalidParameter(`page[size] must be an integer from 1 to ${ MAX_PAGE_SIZE }.`, PAGE_SIZE_PARAMETER);
        }
    }

    const cursor = params[PAGE_AFTER_PARAMETER];

    if (!isUndefined(cursor) && !isNonEmptyString(cursor)) {
        throw invalidParameter('page[after] must be a cursor from a previous links.next.', PAGE_AFTER_PARAMETER);
    }

    const preserved = {};
    for (const name of [ SORT_PARAMETER, PAGE_SIZE_PARAMETER, fieldsParameter ]) {
        if (!isUndefined(params[name])) {
            preserved[name] = params[name];
        }
    }

    return {
        sort,
        limit,
        cursor,
        fields: parseFieldset(params[fieldsParameter], resource, fieldsParameter),
        preserved,
    };
}

/**
 * Reads the observed version a DELETE must carry in its header.
 * @param {Object} request - Incoming request.
 * @returns {number} Positive integer version.
 * @throws {BadRequestError} With code `AdminDataInvalidVersion` when the header is missing or not a positive integer.
 */
export function readExpectedVersionHeader(request) {
    const value = request.headers.get(EXPECTED_VERSION_HEADER);
    const version = Number(value);

    if (!/^[1-9][0-9]*$/.test(value ?? '') || !Number.isSafeInteger(version)) {
        throw withErrorSource(new BadRequestError(
            `${ EXPECTED_VERSION_HEADER } must be the positive integer version last read.`,
            { code: 'AdminDataInvalidVersion' },
        ), { header: EXPECTED_VERSION_HEADER });
    }

    return version;
}

/**
 * Serializes a projected record as a JSON:API resource object.
 * @param {Object} context - Request context, for reverse routing.
 * @param {import('../../../transaction-scripts/admin-data-api/lib.js').AdminDataRecord} record - Projected record.
 * @param {string[]|null} fields - Sparse fieldset, or null for every projected attribute.
 * @returns {Object} JSON:API resource object with server-owned values under `meta`.
 */
export function serializeResource(context, record, fields) {
    let { attributes } = record;

    // A fieldset can only narrow the projection; it never reaches back into
    // the stored record for anything the registration did not declare.
    if (fields) {
        attributes = {};
        for (const name of fields) {
            if (Object.hasOwn(record.attributes, name)) {
                attributes[name] = record.attributes[name];
            }
        }
    }

    return {
        type: record.type,
        id: record.id,
        attributes,
        meta: {
            version: record.version,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        },
        links: {
            self: compileApiPathname(context, RESOURCE_TARGET_NAME, { type: record.type, id: record.id }),
        },
    };
}

/**
 * Builds the complete URL of the next list page.
 * @param {Object} context - Request context, for reverse routing.
 * @param {Object} request - Incoming list request; supplies the origin.
 * @param {string} type - Resource type.
 * @param {Object<string, string>} preserved - Parameters from parseListQuery() to repeat.
 * @param {string} cursor - Signed cursor for the next page.
 * @returns {string} Absolute next-page URL.
 */
export function nextPageUrl(context, request, type, preserved, cursor) {
    const url = new URL(compileApiPathname(context, COLLECTION_TARGET_NAME, { type }), request.url.origin);

    for (const [ name, value ] of Object.entries(preserved)) {
        url.searchParams.set(name, value);
    }
    url.searchParams.set(PAGE_AFTER_PARAMETER, cursor);

    return url.href;
}

// The routes accept an optional trailing slash ({/}), and compiling an
// optional group with no parameters emits it. Links use the canonical form.
function compileApiPathname(context, targetName, params) {
    const { pathname } = context.getHttpTarget(targetName).compilePathname(params);
    return pathname.replace(/\/$/, '');
}

function readQueryParameters(request, allowedNames) {
    const params = request.queryParams;

    for (const [ name, value ] of Object.entries(params)) {
        if (!allowedNames.includes(name)) {
            throw invalidParameter(`Query parameter '${ name }' is not supported.`, name);
        }
        // request.queryParams promotes a repeated key to an array.
        if (Array.isArray(value)) {
            throw invalidParameter(`Query parameter '${ name }' must appear only once.`, name);
        }
    }

    return params;
}

function parseFieldset(value, resource, parameter) {
    if (isUndefined(value)) {
        return null;
    }

    // An empty fieldset is valid JSON:API: it asks for no attributes at all.
    if (value === '') {
        return [];
    }

    const names = value.split(',');

    for (const name of names) {
        if (!Object.hasOwn(resource.attributes, name)) {
            throw invalidParameter(`'${ name }' is not an attribute of ${ resource.type }.`, parameter);
        }
    }

    return names;
}

function fieldsParameterName(resource) {
    return `fields[${ resource.type }]`;
}

function invalidParameter(message, parameter) {
    return withErrorSource(new BadRequestError(message, { code: 'JsonApiInvalidQueryParameter' }), { parameter });
}
