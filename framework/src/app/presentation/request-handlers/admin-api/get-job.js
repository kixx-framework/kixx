import { JSON_API_CONTENT_TYPE } from '../../lib/json-api.js';
import { jobResource } from './job-resources.js';
import { NotFoundError } from '../../../../kixx/errors/mod.js';


/**
 * Returns one job as a JSON:API resource.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Job response.
 * @throws {NotFoundError} When no job has the id.
 */
export async function getJob(context, request, response) {
    const { id } = request.pathnameParams;
    const job = await context.getService('JobQueue').get(context, id);

    if (!job) {
        throw new NotFoundError(`Job "${ id }" was not found.`);
    }

    return response.respondWithJSON(
        200,
        { data: jobResource(job) },
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
