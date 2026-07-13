import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import { readConfig } from '../../../src/kixx/config/read-config.js';


function makeConfig(overrides) {
    return Object.assign({
        name: 'test-app',
        features: {
            uploads: {
                enabled: true,
            },
        },
        environments: {
            development: {
                database: {
                    url: 'http://localhost:8787',
                },
                allowedOrigins: [ 'http://localhost:2026' ],
            },
            production: {
                database: {
                    url: 'https://database.example.com',
                },
            },
        },
    }, overrides);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('readConfig', ({ describe }) => {

    describe('valid configuration', ({ it }) => {
        it('returns top-level fields with the selected environment exposed as env', () => {
            const config = makeConfig();

            const result = readConfig(config, 'development');

            assertEqual('test-app', result.name);
            assertEqual(true, result.features.uploads.enabled);
            assertEqual('http://localhost:8787', result.env.database.url);
            assertEqual(1, result.env.allowedOrigins.length);
            assertEqual('http://localhost:2026', result.env.allowedOrigins[0]);
            assertUndefined(result.environments);
        });

        it('deeply freezes the returned configuration', () => {
            const result = readConfig(makeConfig(), 'development');

            assert(Object.isFrozen(result));
            assert(Object.isFrozen(result.features));
            assert(Object.isFrozen(result.features.uploads));
            assert(Object.isFrozen(result.env));
            assert(Object.isFrozen(result.env.database));
            assert(Object.isFrozen(result.env.allowedOrigins));
        });

        it('includes a filepath resolver when one is provided', () => {
            const resolveFilepath = (filepath) => `/app/${ filepath }`;

            const result = readConfig(makeConfig(), 'development', { resolveFilepath });

            assertEqual(resolveFilepath, result.resolveFilepath);
            assertEqual('/app/pages/index.html', result.resolveFilepath('pages/index.html'));
        });

        it('leaves resolveFilepath undefined when it is omitted', () => {
            const result = readConfig(makeConfig(), 'development');

            assertUndefined(result.resolveFilepath);
        });
    });

    describe('validation', ({ it }) => {
        it('throws an AssertionError when the environment name is empty', () => {
            const caught = catchError(() => readConfig(makeConfig(), ''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('environment name', caught.message);
        });

        it('throws an AssertionError when resolveFilepath is not a function', () => {
            const caught = catchError(() => readConfig(makeConfig(), 'development', { resolveFilepath: '/app' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('options.resolveFilepath', caught.message);
        });

        it('throws an OperationalError when config is not a plain object', () => {
            const caught = catchError(() => readConfig([], 'development'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertMatches('Config must be a plain object', caught.message);
        });

        it('throws an OperationalError when environments is not a plain object', () => {
            const caught = catchError(() => readConfig({ environments: [] }, 'development'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertMatches('Config must contain an environments object', caught.message);
        });

        it('throws an OperationalError when the selected environment is missing', () => {
            const caught = catchError(() => readConfig(makeConfig(), 'test'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertMatches('"test" environment', caught.message);
        });

        it('throws an OperationalError when the selected environment is not a plain object', () => {
            const config = makeConfig({ environments: { development: [] } });
            const caught = catchError(() => readConfig(config, 'development'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertMatches('"development" environment', caught.message);
        });
    });
});
