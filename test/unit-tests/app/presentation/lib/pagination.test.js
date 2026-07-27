import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import InvalidCursorError from '../../../../../src/kixx/document-store/invalid-cursor-error.js';
import { rethrowInvalidCursorAsBadRequest } from '../../../../../src/app/presentation/lib/pagination.js';


describe('rethrowInvalidCursorAsBadRequest()', ({ it }) => {

    it('translates an InvalidCursorError into a client error', () => {
        const cause = new InvalidCursorError();
        const caught = catchError(() => rethrowInvalidCursorAsBadRequest(cause));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual(400, caught.httpStatusCode);
    });

    it('preserves the original error as the cause', () => {
        const cause = new InvalidCursorError();
        const caught = catchError(() => rethrowInvalidCursorAsBadRequest(cause));

        assertEqual(cause, caught.cause);
    });

    it('rethrows an unrelated error unchanged, so real failures are not masked', () => {
        const cause = new Error('the store is unreachable');
        const caught = catchError(() => rethrowInvalidCursorAsBadRequest(cause));

        assertEqual(cause, caught);
    });

    // Callers read the result of their `try` block after the `catch` arm, which is
    // only sound because this helper never falls through. A branch that returned
    // instead of throwing would leave those reads holding `undefined`, so the
    // never-returns contract is pinned here rather than left implicit.
    it('never returns normally, for any error shape', () => {
        const causes = [
            new InvalidCursorError(),
            new Error('unrelated'),
            Object.assign(new Error('named like the cursor error'), { name: 'InvalidCursorError' }),
        ];

        for (const cause of causes) {
            let returned = false;
            try {
                rethrowInvalidCursorAsBadRequest(cause);
                returned = true;
            } catch {
                // Expected: every branch throws.
            }

            assertEqual(false, returned);
        }
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
