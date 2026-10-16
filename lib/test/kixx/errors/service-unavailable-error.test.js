import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { ServiceUnavailableError } from '../../../kixx/errors/mod.js';


describe('ServiceUnavailableError', ({ it }) => {

    it('defines a 503 expected error with a retry hint', () => {
        const error = new ServiceUnavailableError('busy', { retryAfterSeconds: 5 });

        assertEqual('ServiceUnavailableError', error.name);
        assertEqual('SERVICE_UNAVAILABLE_ERROR', error.code);
        assertEqual(503, error.httpStatusCode);
        assertEqual(true, error.httpError);
        assertEqual(true, error.expected);
        assertEqual(5, error.retryAfterSeconds);
        assertEqual('busy', error.message);
    });

    it('keeps a custom code and cause', () => {
        const cause = new Error('overloaded');
        const error = new ServiceUnavailableError('busy', { cause, code: 'StoreOverloaded' });

        assertEqual('StoreOverloaded', error.code);
        assertEqual(cause, error.cause);
    });

    it('honors expected: false', () => {
        const error = new ServiceUnavailableError('busy', { expected: false });

        assertEqual(false, error.expected);
    });

    it('keeps a zero retry hint', () => {
        assertEqual(0, new ServiceUnavailableError('busy', { retryAfterSeconds: 0 }).retryAfterSeconds);
    });

    it('sets retryAfterSeconds to null when omitted or invalid', () => {
        assertEqual(null, new ServiceUnavailableError('busy').retryAfterSeconds);

        for (const value of [ -1, 1.5, '5', NaN ]) {
            const error = new ServiceUnavailableError('busy', { retryAfterSeconds: value });
            assertEqual(null, error.retryAfterSeconds, `retryAfterSeconds ${ String(value) }`);
        }
    });

    it('does not allow retryAfterSeconds to be reassigned', () => {
        const error = new ServiceUnavailableError('busy', { retryAfterSeconds: 5 });

        try {
            error.retryAfterSeconds = 10;
        } catch {
            // Strict mode throws on a non-writable property.
        }

        assertEqual(5, error.retryAfterSeconds);
    });
});
