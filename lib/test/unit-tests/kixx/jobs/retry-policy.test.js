import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { classifyError, nextRetryDelayMs } from '../../../../src/kixx/jobs/retry-policy.js';
import {
    ConflictError,
    NotFoundError,
    OperationalError,
    ValidationError,
} from '../../../../src/kixx/errors/mod.js';


describe('retry-policy', ({ describe }) => {

    describe('classifyError()', ({ it }) => {
        it('treats OperationalError as retryable', () => {
            assertEqual('retryable', classifyError(new OperationalError('down')));
        });

        it('treats other expected classes as terminal', () => {
            assertEqual('terminal', classifyError(new ValidationError('bad')));
            assertEqual('terminal', classifyError(new NotFoundError('gone')));
            assertEqual('terminal', classifyError(new ConflictError('taken')));
        });

        it('lets an explicit retryable boolean override the class default', () => {
            assertEqual('terminal', classifyError(Object.assign(new OperationalError('down'), { retryable: false })));
            assertEqual('retryable', classifyError(Object.assign(new ConflictError('taken'), { retryable: true })));
        });

        it('ignores a non-boolean retryable value', () => {
            assertEqual('retryable', classifyError(Object.assign(new OperationalError('down'), { retryable: 'no' })));
        });

        it('treats anything not expected as unexpected', () => {
            assertEqual('unexpected', classifyError(new TypeError('boom')));
            assertEqual('unexpected', classifyError(new OperationalError('down', { expected: false })));
            assertEqual('unexpected', classifyError(Object.assign(new Error('x'), { expected: 'true', retryable: true })));
            assertEqual('unexpected', classifyError(null));
            assertEqual('unexpected', classifyError('string thrown'));
        });
    });

    describe('nextRetryDelayMs()', ({ it }) => {
        const max = () => 0.999999999;

        it('applies full jitter over an exponential ceiling', () => {
            assertEqual(0, nextRetryDelayMs(1, () => 0));
            assertEqual(5000, nextRetryDelayMs(1, () => 0.5));
            assertEqual(10000, nextRetryDelayMs(2, () => 0.5));
            assertEqual(20000, nextRetryDelayMs(3, () => 0.5));
        });

        it('stays below the ceiling for each attempt', () => {
            assert(nextRetryDelayMs(1, max) < 10000);
            assert(nextRetryDelayMs(4, max) < 80000);
        });

        it('caps the ceiling at one hour', () => {
            // 10s * 2^9 = 5120s exceeds the cap from attempt 10.
            assertEqual(1800000, nextRetryDelayMs(10, () => 0.5));
            assertEqual(1800000, nextRetryDelayMs(500, () => 0.5));
            assert(nextRetryDelayMs(500, max) < 3600000);
        });

        it('defaults to Math.random', () => {
            const delay = nextRetryDelayMs(3);

            assert(delay >= 0 && delay < 40000);
        });

        it('rejects an attempt below 1', () => {
            let caught = null;

            try {
                nextRetryDelayMs(0);
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error');
            assertEqual('AssertionError', caught.name);
        });
    });
});
