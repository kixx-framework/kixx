import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { runJobNow } from '../../../../app/transaction-scripts/jobs/run-job-now.js';
import { jobs } from '../../../../app/jobs/mod.js';
import { PayloadTooLargeError } from '../../../../kixx/errors/mod.js';


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

const PLAIN_JOB = [ 'plain-job', { name: 'plain-job', description: 'Plain job.', handler: noop } ];

function makeContext({ result, rejection } = {}) {
    const calls = [];

    const queue = {
        async enqueue(context, name, payload, options) {
            calls.push({ context, name, payload, options });

            if (rejection) {
                throw rejection;
            }

            return result ?? {
                id: 'job-1',
                name,
                key: options.key,
                status: 'pending',
                runAt: '2026-10-16T00:00:00.000Z',
                created: true,
                extra: 'not returned',
            };
        },
    };

    const context = {
        calls,
        getService(name) {
            assertEqual('JobQueue', name);
            return queue;
        },
    };

    return context;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('runJobNow transaction script', ({ it }) => {

    it('enqueues a registered job with the admin-run dedupe key', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const context = makeContext();

            const result = await runJobNow(context, { name: 'plain-job', payload: { a: 1 } });

            assertEqual(1, context.calls.length);
            const [ call ] = context.calls;
            assertEqual(context, call.context);
            assertEqual('plain-job', call.name);
            assertEqual(1, call.payload.a);
            assertEqual('key', Object.keys(call.options).join(','));
            assertEqual('admin-run:plain-job', call.options.key);

            assertEqual('id,name,key,status,runAt,created', Object.keys(result).join(','));
            assertEqual('job-1', result.id);
            assertEqual('admin-run:plain-job', result.key);
            assertEqual(true, result.created);
        });
    });

    it('passes null and array payloads through', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const context = makeContext();

            await runJobNow(context, { name: 'plain-job', payload: null });
            await runJobNow(context, { name: 'plain-job', payload: [ 1, 2 ] });

            assertEqual(null, context.calls[0].payload);
            assert(Array.isArray(context.calls[1].payload));
            assertEqual('1,2', context.calls[1].payload.join(','));
        });
    });

    it('returns created: false for an already active manual run', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const context = makeContext({
                result: {
                    id: 'job-7',
                    name: 'plain-job',
                    key: 'admin-run:plain-job',
                    status: 'running',
                    runAt: '2026-10-16T00:00:00.000Z',
                    created: false,
                },
            });

            const result = await runJobNow(context, { name: 'plain-job', payload: {} });

            assertEqual('job-7', result.id);
            assertEqual('running', result.status);
            assertEqual(false, result.created);
        });
    });

    it('rejects unregistered, empty, and non-string names without enqueueing', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const context = makeContext();

            for (const name of [ 'other-job', '', undefined, 42 ]) {
                const error = await catchAsyncError(() => runJobNow(context, { name, payload: {} }));
                assert(error);
                assertEqual('NotFoundError', error.name);
                assertEqual('JobNotRegistered', error.code);
            }

            assertEqual(0, context.calls.length);
        });
    });

    it('rethrows PayloadTooLargeError unchanged', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const realError = new PayloadTooLargeError('too big');
            const plainError = { name: 'PayloadTooLargeError', message: 'too big' };

            for (const rejection of [ realError, plainError ]) {
                const context = makeContext({ rejection });
                const error = await catchAsyncError(() => runJobNow(context, { name: 'plain-job', payload: {} }));
                assertEqual(rejection, error);
            }
        });
    });

    it('wraps unexpected enqueue errors in an AssertionError', async () => {
        await withRegisteredJobs([ PLAIN_JOB ], async () => {
            const cause = new Error('boom');
            const context = makeContext({ rejection: cause });

            const error = await catchAsyncError(() => runJobNow(context, { name: 'plain-job', payload: {} }));

            assert(error);
            assertEqual('AssertionError', error.name);
            assertEqual(cause, error.cause);
        });
    });

    it('leaves the registry empty afterwards', () => {
        assertEqual(0, jobs.size);
    });
});
