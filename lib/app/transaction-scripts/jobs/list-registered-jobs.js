import { jobs } from '../../jobs/mod.js';
import { validateJobRegistry } from '../../../kixx/jobs/job-registry.js';


/**
 * Lists the jobs registered in this build, with defaults resolved exactly as
 * the queue resolves them. Handlers and parsed cron are never exposed.
 * @param {import('../../../kixx/context/request-context.js').default} _context - Active request context.
 * @returns {Promise<Array<{name: string, description: string, maxAttempts: number, timeoutSeconds: number, cron: string|null}>>} Registry entries in registry order.
 */
export async function listRegisteredJobs(_context) {
    const resolved = validateJobRegistry(jobs);

    return Array.from(resolved.values()).map((entry) => {
        return {
            name: entry.name,
            description: entry.description,
            maxAttempts: entry.maxAttempts,
            timeoutSeconds: entry.timeoutSeconds,
            cron: entry.schedule ? entry.schedule.cron : null,
        };
    });
}
