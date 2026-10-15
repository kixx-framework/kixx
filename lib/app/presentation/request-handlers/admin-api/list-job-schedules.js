import { JSON_API_CONTENT_TYPE, jsonApiResource } from '../../lib/json-api.js';


/**
 * Lists declared recurring schedules with their next and last run.
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} _request - Incoming request.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} Schedule collection response.
 */
export async function listJobSchedules(context, _request, response) {
    const schedules = await context.getService('JobQueue').listSchedules(context);

    const data = schedules.map((schedule) => {
        const { name, cron, nextRunAt, lastEnqueuedAt, lastJobId } = schedule;

        return jsonApiResource({
            type: 'JobSchedule',
            id: name,
            attributes: { cron, nextRunAt, lastEnqueuedAt, lastJobId },
        }).data;
    });

    return response.respondWithJSON(
        200,
        { data },
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
