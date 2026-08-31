import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import { mergeEnvironmentSources } from '../../../../src/kixx/config/merge-environment-sources.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('mergeEnvironmentSources', ({ describe }) => {

    describe('disjoint sources', ({ it }) => {
        it('returns the union of every source', () => {
            const result = mergeEnvironmentSources([
                { name: '.env.production', values: { PORT: '2026', TRUST_PROXY: 'true' } },
                { name: '.env.production.secrets', values: { CSRF_TOKEN_SIGNING_SECRET: 'abc' } },
                { name: 'process.env', values: { BUILD_ID: 'build-7' } },
            ]);

            assertEqual('2026', result.PORT);
            assertEqual('true', result.TRUST_PROXY);
            assertEqual('abc', result.CSRF_TOKEN_SIGNING_SECRET);
            assertEqual('build-7', result.BUILD_ID);
        });

        it('produces the same result regardless of source order', () => {
            const sources = [
                { name: 'a', values: { ONE: '1' } },
                { name: 'b', values: { TWO: '2' } },
            ];

            const forward = mergeEnvironmentSources(sources);
            const reversed = mergeEnvironmentSources(sources.slice().reverse());

            assertEqual(forward.ONE, reversed.ONE);
            assertEqual(forward.TWO, reversed.TWO);
        });

        it('treats a __proto__ key as an ordinary value rather than a prototype', () => {
            // An object literal would assign the prototype instead of creating
            // an own key, so build the source the way a parsed dotenv file does.
            const values = Object.create(null);
            values.__proto__ = { polluted: true };

            const result = mergeEnvironmentSources([ { name: 'a', values } ]);

            assertEqual(null, Object.getPrototypeOf(result));
            assertEqual(true, result.__proto__.polluted);
            assertUndefined({}.polluted);
        });
    });

    describe('empty and omitted sources', ({ it }) => {
        it('accepts an empty source list', () => {
            const result = mergeEnvironmentSources([]);

            assertEqual(0, Object.keys(result).length);
        });

        it('accepts a source with no values', () => {
            const result = mergeEnvironmentSources([
                { name: '.env.production' },
                { name: 'process.env', values: { PORT: '2026' } },
            ]);

            assertEqual('2026', result.PORT);
            assertEqual(1, Object.keys(result).length);
        });

        it('accepts an object with a null prototype, such as a parsed dotenv file', () => {
            const values = Object.create(null);
            values.PORT = '2026';

            const result = mergeEnvironmentSources([
                { name: '.env.production', values },
            ]);

            assertEqual('2026', result.PORT);
        });
    });

    describe('duplicate keys', ({ it }) => {
        it('throws when a key is defined by two sources', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([
                    { name: '.env.production', values: { CSRF_TOKEN_SIGNING_SECRET: 'plain' } },
                    { name: '.env.production.secrets', values: { CSRF_TOKEN_SIGNING_SECRET: 'secret' } },
                ]);
            });

            assert(error, 'expected an error to be thrown');
            assertEqual('OperationalError', error.name);
            assertMatches('CSRF_TOKEN_SIGNING_SECRET', error.message);
        });

        it('names both sources which defined the key', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([
                    { name: '.env.production', values: { PORT: '2026' } },
                    { name: 'process.env', values: { PORT: '8080' } },
                ]);
            });

            assertMatches('.env.production', error.message);
            assertMatches('process.env', error.message);
        });

        it('reports every duplicate key in a single error', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([
                    { name: 'a', values: { ONE: '1', TWO: '2', THREE: '3' } },
                    { name: 'b', values: { ONE: '1', THREE: '3' } },
                ]);
            });

            assertMatches('ONE', error.message);
            assertMatches('THREE', error.message);
            // TWO is unique to source "a" and must not be reported.
            assertEqual(false, error.message.includes('TWO'));
        });

        it('names all three sources when a key is defined by every one', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([
                    { name: 'a', values: { PORT: '1' } },
                    { name: 'b', values: { PORT: '2' } },
                    { name: 'c', values: { PORT: '3' } },
                ]);
            });

            assertMatches('a and b and c', error.message);
        });
    });

    describe('invalid arguments', ({ it }) => {
        it('throws when sources is not an array', () => {
            const error = catchError(() => {
                mergeEnvironmentSources({ name: 'a', values: {} });
            });

            assert(error, 'expected an error to be thrown');
            assertMatches('mergeEnvironmentSources: sources', error.message);
        });

        it('throws when a source has no name', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([ { values: { PORT: '2026' } } ]);
            });

            assertMatches('mergeEnvironmentSources: source.name', error.message);
        });

        it('throws when a source value is not an object', () => {
            const error = catchError(() => {
                mergeEnvironmentSources([ { name: 'a', values: 'PORT=2026' } ]);
            });

            assertMatches('mergeEnvironmentSources: source.values', error.message);
        });
    });
});
