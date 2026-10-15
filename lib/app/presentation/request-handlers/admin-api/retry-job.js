import { JSON_API_CONTENT_TYPE } from '../../lib/json-api.js';
import { jobResource } from './job-resources.js';


/**
 * Retries a failed job. The service owns eligibility: an unknown id is a
 * NotFoundError, and a job that is not failed (or whose dedupe key or schedule
 * is held by an active job) is a ConflictError.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} The re-queued job.
 */
export async function retryJob(context, request, response) {
    const job = await context.getService('JobQueue').retry(context, request.pathnameParams.id);

    return response.respondWithJSON(
        200,
        { data: jobResource(job) },
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
