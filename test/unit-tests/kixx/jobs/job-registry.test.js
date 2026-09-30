import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import {
    validateJobRegistry,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_TIMEOUT_SECONDS,
} from '../../../../src/kixx/jobs/job-registry.js';


describe('job-registry', ({ describe }) => {

    describe('validateJobRegistry()', ({ it }) => {
        it('accepts an empty registry', () => {
            const resolved = validateJobRegistry(new Map());

            assert(resolved instanceof Map);
            assertEqual(0, resolved.size);
        });

        it('applies defaults and returns frozen entries', () => {
            const entry = makeEntry('send-email');
            const resolved = validateJobRegistry(new Map([ [ 'send-email', entry ] ]));
            const job = resolved.get('send-email');

            assertEqual(DEFAULT_MAX_ATTEMPTS, job.maxAttempts);
            assertEqual(DEFAULT_TIMEOUT_SECONDS, job.timeoutSeconds);
            assertEqual(5, job.maxAttempts);
            assertEqual(60, job.timeoutSeconds);
            assertEqual(null, job.schedule);
            assertEqual(entry.handler, job.handler);
            assert(Object.isFrozen(job));
        });

        it('keeps explicit options', () => {
            const resolved = validateJobRegistry(registryOf(makeEntry('slow-job', { maxAttempts: 2, timeoutSeconds: 300 })));
            const job = resolved.get('slow-job');

            assertEqual(2, job.maxAttempts);
            assertEqual(300, job.timeoutSeconds);
        });

        it('parses the schedule cron', () => {
            const resolved = validateJobRegistry(registryOf(makeEntry('heartbeat', { schedule: { cron: '*/15 * * * *' } })));
            const { schedule } = resolved.get('heartbeat');

            assertEqual('*/15 * * * *', schedule.cron);
            assertEqual('0,15,30,45', schedule.parsed.minutes.join(','));
            assert(Object.isFrozen(schedule));
        });

        it('preserves registry order', () => {
            const resolved = validateJobRegistry(registryOf(makeEntry('b-job'), makeEntry('a-job')));

            assertEqual('b-job,a-job', Array.from(resolved.keys()).join(','));
        });

        it('rejects a registry that is not a Map', () => {
            assertRejected(() => validateJobRegistry({}), 'must be a Map');
            assertRejected(() => validateJobRegistry(null), 'must be a Map');
        });

        it('rejects a bad name', () => {
            for (const name of [ 'Send-Email', 'send_email', '-send', 'send-', 'send--email', '' ]) {
                assertRejected(() => validateJobRegistry(new Map([ [ name, makeEntry(name) ] ])));
            }
        });

        it('rejects a key that does not equal entry.name', () => {
            assertRejected(() => validateJobRegistry(new Map([ [ 'one', makeEntry('two') ] ])), 'must equal entry.name');
        });

        it('rejects a non-object entry', () => {
            assertRejected(() => validateJobRegistry(new Map([ [ 'one', 'nope' ] ])), 'plain object');
        });

        it('rejects a missing description', () => {
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { description: '' }))), 'description');
        });

        it('rejects a non-function handler', () => {
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { handler: 'nope' }))), 'handler');
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { handler: undefined }))), 'handler');
        });

        it('rejects invalid maxAttempts and timeoutSeconds', () => {
            for (const value of [ 0, -1, 1.5, '5', null, NaN ]) {
                assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { maxAttempts: value }))), 'maxAttempts');
                assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { timeoutSeconds: value }))), 'timeoutSeconds');
            }
        });

        it('rejects a bad cron expression', () => {
            assertRejected(
                () => validateJobRegistry(registryOf(makeEntry('one', { schedule: { cron: '61 * * * *' } }))),
                'entry.schedule.cron for "one" is invalid',
            );
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { schedule: { cron: '' } }))), 'cron');
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { schedule: '* * * * *' }))), 'schedule');
        });

        it('rejects per-entry concurrency', () => {
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { concurrency: 1 }))), 'concurrency');
        });

        it('rejects a schedule timezone', () => {
            assertRejected(
                () => validateJobRegistry(registryOf(makeEntry('one', { schedule: { cron: '0 0 * * *', timezone: 'UTC' } }))),
                'timezone',
            );
        });

        it('rejects unknown entry fields', () => {
            assertRejected(() => validateJobRegistry(registryOf(makeEntry('one', { priority: 1 }))), 'unknown field "priority"');
        });
    });
});

function makeEntry(name, overrides = {}) {
    return {
        name,
        description: `Runs ${ name }`,
        handler: async () => {},
        ...overrides,
    };
}

function registryOf(...entries) {
    return new Map(entries.map((entry) => [ entry.name, entry ]));
}

function assertRejected(fn, fragment) {
    let caught = null;

    try {
        fn();
    } catch (error) {
        caught = error;
    }

    assert(caught, 'expected an error to be thrown');
    assertEqual('AssertionError', caught.name);

    if (fragment) {
        assert(caught.message.includes(fragment), `expected "${ fragment }" in "${ caught.message }"`);
    }
}
