import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { listRegisteredJobs } from '../../../../app/transaction-scripts/jobs/list-registered-jobs.js';
import { jobs } from '../../../../app/jobs/mod.js';
import { createRecurringTestRegistry } from '../../../fixtures/jobs/example-noop-heartbeat.js';


async function noop() {}

async function withRegisteredJobs(entries, fn) {
    for (const [ name, entry ] of entries) {
        jobs.set(name, entry);
    }

    try {
        await fn();
    } finally {
        for (const [ name ] of entries) {
            jobs.delete(name);
        }
    }
}

function makeFixtureEntries() {
    return [
        [ 'plain-job', { name: 'plain-job', description: 'Plain job.', handler: noop } ],
        [ 'tuned-job', {
            name: 'tuned-job',
            description: 'Tuned job.',
            handler: noop,
            maxAttempts: 2,
            timeoutSeconds: 10,
        } ],
        ...createRecurringTestRegistry(),
    ];
}


describe('listRegisteredJobs transaction script', ({ it }) => {

    it('returns an empty list for the shipped registry', async () => {
        const result = await listRegisteredJobs({});
        assertEqual(0, result.length);
    });

    it('returns entries in registry order with resolved defaults', async () => {
        await withRegisteredJobs(makeFixtureEntries(), async () => {
            const result = await listRegisteredJobs({});

            assertEqual('plain-job,tuned-job,example-noop-heartbeat', result.map(({ name }) => name).join(','));

            const [ plain, tuned, scheduled ] = result;

            assertEqual('Plain job.', plain.description);
            assertEqual(5, plain.maxAttempts);
            assertEqual(60, plain.timeoutSeconds);
            assertEqual(null, plain.cron);

            assertEqual(2, tuned.maxAttempts);
            assertEqual(10, tuned.timeoutSeconds);
            assertEqual(null, tuned.cron);

            assertEqual('*/15 * * * *', scheduled.cron);
        });
    });

    it('never exposes handlers or the parsed schedule', async () => {
        await withRegisteredJobs(makeFixtureEntries(), async () => {
            const result = await listRegisteredJobs({});

            for (const row of result) {
                assertEqual('name,description,maxAttempts,timeoutSeconds,cron', Object.keys(row).join(','));
            }
        });
    });

    it('leaves the registry empty afterwards', () => {
        assertEqual(0, jobs.size);
    });
});
