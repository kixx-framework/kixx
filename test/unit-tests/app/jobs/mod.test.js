import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { jobs } from '../../../../src/app/jobs/mod.js';
import { validateJobRegistry } from '../../../../src/kixx/jobs/job-registry.js';
import {
    createRecurringTestRegistry,
    createValidatedRecurringTestRegistry,
} from '../../../fixtures/jobs/example-noop-heartbeat.js';


describe('app/jobs/mod', ({ it }) => {
    it('ships a valid registry with no jobs or schedules', () => {
        const resolved = validateJobRegistry(jobs);
        assertEqual(0, resolved.size);
    });

    it('validates the recurring test fixture registry', () => {
        const resolved = createValidatedRecurringTestRegistry();
        const entry = resolved.get('example-noop-heartbeat');

        assertEqual('*/15 * * * *', entry.schedule.cron);
        assertEqual(5, entry.maxAttempts);
        assertEqual(60, entry.timeoutSeconds);
    });

    it('creates an independent fixture registry per call', () => {
        assertEqual(false, createRecurringTestRegistry() === createRecurringTestRegistry());
    });
});
