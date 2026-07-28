import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    assertCanonicalIdentifier,
    isCanonicalIdentifier,
    normalizeIdentifier,
} from '../../../../src/kixx/hyperview/canonical-identifiers.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('canonical identifiers', ({ describe }) => {

    describe('normalizeIdentifier()', ({ it }) => {
        it('folds an identifier with locale-independent lower-case semantics', () => {
            const tracker = new MockTracker();

            tracker.method(String.prototype, 'toLocaleLowerCase', () => {
                throw new Error('toLocaleLowerCase() must not be used');
            });

            try {
                assertEqual('images/icon.png', normalizeIdentifier('Images/Icon.png'));
            } finally {
                tracker.reset();
            }
        });
    });

    describe('isCanonicalIdentifier()', ({ it }) => {
        it('accepts a canonical multi-segment identifier', () => {
            assert(isCanonicalIdentifier('blog/posts/welcome.html'));
        });

        it('rejects invalid and non-canonical values', () => {
            assertFalsy(isCanonicalIdentifier(null));
            assertFalsy(isCanonicalIdentifier(''));
            assertFalsy(isCanonicalIdentifier('../welcome.html'));
            assertFalsy(isCanonicalIdentifier('.private/welcome.html'));
            assertFalsy(isCanonicalIdentifier('blog/wélcome.html'));
            assertFalsy(isCanonicalIdentifier('Blog/welcome.html'));
        });
    });

    describe('assertCanonicalIdentifier()', ({ it }) => {
        const invalidValues = [
            [ null, 'non-string' ],
            [ '', 'empty string' ],
            [ '../welcome.html', 'traversal segment' ],
            [ '.private/welcome.html', 'leading-dot segment' ],
            [ 'blog/wélcome.html', 'out-of-charset character' ],
            [ 'Blog/welcome.html', 'mixed-case value' ],
        ];

        for (const [ value, label ] of invalidValues) {
            it(`throws AssertionError for a ${ label }`, () => {
                const error = catchError(() => {
                    assertCanonicalIdentifier(value, 'test caller: identifier');
                });

                assert(error, 'expected an error to be thrown');
                assertEqual('AssertionError', error.name);
                assertMatches('test caller: identifier', error.message);
            });
        }

        it('accepts a canonical multi-segment identifier', () => {
            assertCanonicalIdentifier(
                'blog/posts/welcome.html',
                'test caller: identifier',
            );
        });

        it('reports validity before canonical case', () => {
            const error = catchError(() => {
                assertCanonicalIdentifier(
                    'Blog/Wélcome.html',
                    'test caller: identifier',
                );
            });

            assert(error, 'expected an error to be thrown');
            assertMatches('must be a valid pathname', error.message);
            assertFalsy(error.message.includes('lower case'));
        });
    });
});
