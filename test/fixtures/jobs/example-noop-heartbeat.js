import { validateJobRegistry } from '../../../src/kixx/jobs/job-registry.js';


/**
 * Recurring no-op handler for adapter tests. Records each run so tests can
 * assert on execution without any real side effects.
 */
export const heartbeatRuns = [];

export async function heartbeat(_context, job) {
    heartbeatRuns.push({ id: job.id, attempt: job.attempt, scheduledFor: job.scheduledFor });
}

/**
 * Builds a fresh, unvalidated recurring registry. Never registered by normal
 * application boot.
 * @returns {Map<string, Object>}
 */
export function createRecurringTestRegistry() {
    return new Map([
        [ 'example-noop-heartbeat', {
            name: 'example-noop-heartbeat',
            description: 'Test-only recurring no-op.',
            handler: heartbeat,
            schedule: { cron: '*/15 * * * *' },
        } ],
    ]);
}

/**
 * @returns {Map<string, Object>} Validated, resolved recurring registry.
 */
export function createValidatedRecurringTestRegistry() {
    return validateJobRegistry(createRecurringTestRegistry());
}
