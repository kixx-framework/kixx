import { JSON_API_CONTENT_TYPE } from '../../lib/json-api.js';
import { jobResource } from './job-resources.js';
import { BadRequestError, ValidationError } from '../../../../kixx/errors/mod.js';


const STATUSES = [ 'pending', 'running', 'completed', 'failed' ];
const MAX_LIMIT = 200;


/**
 * Lists jobs, newest first, as JSON:API resources with cursor pagination.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Job collection response.
 * @throws {BadRequestError} When a query parameter is invalid.
 */
export async function listJobs(context, request, response) {
    const options = parseQuery(request.queryParams ?? {});

    let result;
    try {
        result = await context.getService('JobQueue').list(context, options);
    } catch (cause) {
        // The only client-owned input the service can reject is the cursor.
        if (cause instanceof ValidationError) {
            throw new BadRequestError(cause.message, { cause });
        }
        throw cause;
    }

    return response.respondWithJSON(
        200,
        {
            data: result.jobs.map(jobResource),
            meta: { cursor: result.cursor },
        },
        { contentType: JSON_API_CONTENT_TYPE },
    );
}

function parseQuery(query) {
    const options = {};

    const status = singleValue(query, 'status');
    if (status !== undefined) {
        if (!STATUSES.includes(status)) {
            throw new BadRequestError(`Query parameter "status" must be one of: ${ STATUSES.join(', ') }.`);
        }
        options.status = status;
    }

    const name = singleValue(query, 'name');
    if (name !== undefined) {
        options.name = name;
    }

    const cursor = singleValue(query, 'cursor');
    if (cursor !== undefined) {
        options.cursor = cursor;
    }

    const limit = singleValue(query, 'limit');
    if (limit !== undefined) {
        const parsed = Number(limit);

        if (!/^\d+$/.test(limit) || parsed < 1 || parsed > MAX_LIMIT) {
            throw new BadRequestError(`Query parameter "limit" must be an integer from 1 to ${ MAX_LIMIT }.`);
        }
        options.limit = parsed;
    }

    return options;
}

// An empty value is treated as absent; repeated values are rejected.
function singleValue(query, key) {
    const value = query[key];

    if (value === undefined || value === '') {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new BadRequestError(`Query parameter "${ key }" must appear at most once.`);
    }

    return value;
}
