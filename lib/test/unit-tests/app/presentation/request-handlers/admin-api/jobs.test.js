import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    listJobs,
    getJob,
    retryJob,
    listJobSchedules,
} from '../../../../../../src/app/presentation/request-handlers/admin-api/mod.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../../../../src/kixx/errors/mod.js';
import { deriveRolePermissions } from '../../../../../../src/app/permissions/roles.js';
import { evaluatePermissions } from '../../../../../../src/kixx/permissions/permission-validation.js';
import routes from '../../../../../../src/routes/admin-api-v1.js';


const JOB = {
    id: 'job-1',
    name: 'one',
    key: null,
    scheduleName: null,
    payload: { a: 1 },
    status: 'failed',
    attempt: 5,
    maxAttempts: 5,
    runAt: '2026-03-10T00:00:00.000Z',
    scheduledFor: null,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:01:00.000Z',
    finishedAt: '2026-03-10T00:01:00.000Z',
    lastError: { name: 'OperationalError', message: 'nope', expected: true },
};

function makeContext(queue) {
    return { getService: (name) => {
        assertEqual('JobQueue', name);
        return queue;
    } };
}

function makeResponse() {
    return { respondWithJSON: (status, body, options) => ({ status, body, options }) };
}

function catchAsync(promise) {
    return promise.then(() => null, (error) => error);
}


describe('Admin API job handlers', ({ describe }) => {

    describe('listJobs', ({ it }) => {
        it('passes validated filters and returns resources with the cursor', async () => {
            let received;
            const queue = { list: async (_context, options) => {
                received = options;
                return { jobs: [ JOB ], cursor: 'next' };
            } };

            const result = await listJobs(
                makeContext(queue),
                { queryParams: { status: 'failed', name: 'one', limit: '10', cursor: 'abc' } },
                makeResponse(),
            );

            assertEqual('failed', received.status);
            assertEqual('one', received.name);
            assertEqual(10, received.limit);
            assertEqual('abc', received.cursor);
            assertEqual(200, result.status);
            assertEqual('Job', result.body.data[0].type);
            assertEqual('job-1', result.body.data[0].id);
            assertEqual('one', result.body.data[0].attributes.name);
            assertEqual('next', result.body.meta.cursor);
            assertEqual('application/vnd.api+json', result.options.contentType);
        });

        it('rejects an unknown status and out-of-range limits with 400', async () => {
            const context = makeContext({ list: async () => ({ jobs: [], cursor: null }) });

            for (const queryParams of [ { status: 'bogus' }, { limit: '0' }, { limit: '201' }, { limit: 'x' }, { name: [ 'a', 'b' ] } ]) {
                const error = await catchAsync(listJobs(context, { queryParams }, makeResponse()));

                assertEqual('BadRequestError', error.name, JSON.stringify(queryParams));
            }
        });

        it('maps an invalid cursor from the service to 400', async () => {
            const context = makeContext({ list: async () => {
                throw new ValidationError('Invalid cursor.');
            } });
            const error = await catchAsync(listJobs(context, { queryParams: { cursor: 'x' } }, makeResponse()));

            assertEqual('BadRequestError', error.name);
        });
    });

    describe('getJob', ({ it }) => {
        it('returns the job', async () => {
            const queue = { get: async (_context, id) => (id === 'job-1' ? JOB : null) };
            const result = await getJob(makeContext(queue), { pathnameParams: { id: 'job-1' } }, makeResponse());

            assertEqual('job-1', result.body.data.id);
        });

        it('throws NotFoundError for a missing job', async () => {
            const queue = { get: async () => null };
            const error = await catchAsync(getJob(makeContext(queue), { pathnameParams: { id: 'x' } }, makeResponse()));

            assert(error instanceof NotFoundError);
        });
    });

    describe('retryJob', ({ it }) => {
        it('returns the re-queued job', async () => {
            const queue = { retry: async (_context, id) => ({ ...JOB, id, status: 'pending', attempt: 0 }) };
            const result = await retryJob(makeContext(queue), { pathnameParams: { id: 'job-1' } }, makeResponse());

            assertEqual('pending', result.body.data.attributes.status);
        });

        it('lets service NotFoundError and ConflictError propagate', async () => {
            for (const ErrorClass of [ NotFoundError, ConflictError ]) {
                const queue = { retry: async () => {
                    throw new ErrorClass('nope');
                } };
                const error = await catchAsync(retryJob(makeContext(queue), { pathnameParams: { id: 'x' } }, makeResponse()));

                assert(error instanceof ErrorClass);
            }
        });
    });

    describe('listJobSchedules', ({ it }) => {
        it('returns schedules keyed by name', async () => {
            const queue = { listSchedules: async () => [ {
                name: 'example-noop-heartbeat',
                cron: '*/15 * * * *',
                nextRunAt: '2026-03-10T00:15:00.000Z',
                lastEnqueuedAt: null,
                lastJobId: null,
            } ] };
            const result = await listJobSchedules(makeContext(queue), {}, makeResponse());

            assertEqual('JobSchedule', result.body.data[0].type);
            assertEqual('example-noop-heartbeat', result.body.data[0].id);
            assertEqual('2026-03-10T00:15:00.000Z', result.body.data[0].attributes.nextRunAt);
        });
    });

    describe('routes and permissions', ({ it }) => {
        it('declares the four job endpoints behind admin API authentication', () => {
            const jobs = routes.find((route) => route.pattern === '/jobs');
            const schedules = routes.find((route) => route.pattern === '/job-schedules{/}');

            assertEqual(1, jobs.inboundMiddleware.length);
            assertEqual(1, schedules.inboundMiddleware.length);
            assertEqual('{/},/:id/retry,/:id', jobs.routes.map((route) => route.pattern).join(','));
            assertEqual('GET', schedules.targets[0].methods[0]);
            assertEqual('POST', jobs.routes[1].targets[0].methods[0]);
        });

        it('grants the developer role all job actions and denies unknown roles', () => {
            const resource = 'urn:kixx:admin:jobs';

            for (const action of [ 'urn:kixx:list', 'urn:kixx:get', 'urn:kixx:update' ]) {
                assertEqual(true, evaluatePermissions(deriveRolePermissions([ 'developer' ]), { action, resource }));
                assertEqual(false, evaluatePermissions(deriveRolePermissions([ 'unknown-role' ]), { action, resource }));
            }
        });

        it('does not shadow the retry route with the id route', () => {
            const jobs = routes.find((route) => route.pattern === '/jobs');

            assertMatches('retry', jobs.routes[1].name);
        });
    });
});
