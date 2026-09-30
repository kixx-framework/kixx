import { jsonApiResource } from '../../lib/json-api.js';


/**
 * Projects a queue job record as a JSON:API resource object.
 * @param {import('../../../../kixx/jobs/job-queue-interface.js').JobRecord} job
 * @returns {Object} JSON:API resource object (the `data` member).
 */
export function jobResource(job) {
    const {
        id,
        name,
        key,
        scheduleName,
        payload,
        status,
        attempt,
        maxAttempts,
        runAt,
        scheduledFor,
        createdAt,
        updatedAt,
        finishedAt,
        lastError,
    } = job;

    return jsonApiResource({
        type: 'Job',
        id,
        attributes: {
            name,
            key,
            scheduleName,
            payload,
            status,
            attempt,
            maxAttempts,
            runAt,
            scheduledFor,
            createdAt,
            updatedAt,
            finishedAt,
            lastError,
        },
    }).data;
}
