import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import { readConfig } from '../../../kixx/config/read-config.js';


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

        it('uses the selected environment instead of a top-level env field', () => {
            const config = makeConfig({
                env: {
                    database: {
                        url: 'https://incorrect.example.com',
                    },
                },
            });

            const result = readConfig(config, 'development');

            assertEqual('http://localhost:8787', result.env.database.url);
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
            const config = makeConfig({
                resolveFilepath: () => '/incorrect',
            });
            const resolveFilepath = (filepath) => `/app/${ filepath }`;

            const result = readConfig(config, 'development', { resolveFilepath });

            assertEqual(resolveFilepath, result.resolveFilepath);
            assertEqual('/app/pages/index.html', result.resolveFilepath('pages/index.html'));
        });

        it('does not expose a source config filepath resolver when the runtime option is omitted', () => {
            const config = makeConfig({
                resolveFilepath: () => '/incorrect',
            });

            const result = readConfig(config, 'development');

            assertUndefined(result.resolveFilepath);
        });
    });

    describe('with defaults', ({ it }) => {
        function makeDefaults() {
            return {
                HYPERVIEW: {
                    useTemplateCache: false,
                    cache: {
                        ttlSeconds: 86400,
                        enabled: false,
                    },
                },
                ALLOWED_HOSTS: [ 'localhost', '127.0.0.1' ],
                STORE: { kind: 'sqlite' },
                LIMIT: 10,
                TOKEN: { length: 32 },
            };
        }

        function readWithDefaults(environment) {
            const config = { name: 'test-app', environments: { development: environment } };

            return readConfig(config, 'development', { defaults: makeDefaults() });
        }

        it('merges a nested plain object key by key at two depths', () => {
            const result = readWithDefaults({
                HYPERVIEW: {
                    useTemplateCache: true,
                    cache: { enabled: true },
                },
            });

            assertEqual(true, result.env.HYPERVIEW.useTemplateCache);
            assertEqual(true, result.env.HYPERVIEW.cache.enabled);
            assertEqual(86400, result.env.HYPERVIEW.cache.ttlSeconds);
        });

        it('replaces a default array whole with a project array', () => {
            const result = readWithDefaults({ ALLOWED_HOSTS: [ 'example.com' ] });

            assertEqual(1, result.env.ALLOWED_HOSTS.length);
            assertEqual('example.com', result.env.ALLOWED_HOSTS[0]);
        });

        it('replaces a default object with a project scalar', () => {
            const result = readWithDefaults({ STORE: 'memory' });

            assertEqual('memory', result.env.STORE);
        });

        it('replaces a default scalar with a project object', () => {
            const result = readWithDefaults({ LIMIT: { perMinute: 5 } });

            assertEqual(5, result.env.LIMIT.perMinute);
        });

        it('replaces a default with a project null', () => {
            const result = readWithDefaults({ TOKEN: null, HYPERVIEW: { cache: null } });

            assertEqual(null, result.env.TOKEN);
            assertEqual(null, result.env.HYPERVIEW.cache);
            assertEqual(false, result.env.HYPERVIEW.useTemplateCache);
        });

        it('includes a default section the project does not mention', () => {
            const result = readWithDefaults({});

            assertEqual('sqlite', result.env.STORE.kind);
            assertEqual(10, result.env.LIMIT);
            assertEqual(2, result.env.ALLOWED_HOSTS.length);
        });

        it('passes through a project section that has no default', () => {
            const result = readWithDefaults({ LOGGER: { level: 'info' } });

            assertEqual('info', result.env.LOGGER.level);
        });

        it('leaves the defaults unchanged and unfrozen', () => {
            const defaults = makeDefaults();
            const config = {
                environments: {
                    development: {
                        HYPERVIEW: { cache: { enabled: true } },
                        ALLOWED_HOSTS: [ 'example.com' ],
                    },
                },
            };

            const result = readConfig(config, 'development', { defaults });

            assertEqual(JSON.stringify(makeDefaults()), JSON.stringify(defaults));
            assertEqual(false, Object.isFrozen(defaults));
            assertEqual(false, Object.isFrozen(defaults.HYPERVIEW));
            assertEqual(false, Object.isFrozen(defaults.HYPERVIEW.cache));
            assertEqual(false, Object.isFrozen(defaults.ALLOWED_HOSTS));
            assert(result.env.HYPERVIEW !== defaults.HYPERVIEW, 'expected the defaults to be copied');
            assert(result.env.STORE !== defaults.STORE, 'expected the defaults to be copied');
        });

        it('deeply freezes the merged environment', () => {
            const result = readWithDefaults({ HYPERVIEW: { cache: { enabled: true } } });

            assert(Object.isFrozen(result));
            assert(Object.isFrozen(result.env));
            assert(Object.isFrozen(result.env.HYPERVIEW));
            assert(Object.isFrozen(result.env.HYPERVIEW.cache));
            assert(Object.isFrozen(result.env.ALLOWED_HOSTS));
            assert(Object.isFrozen(result.env.STORE));
        });

        it('keeps the top-level fields, the environment name, and the filepath resolver', () => {
            const resolveFilepath = (filepath) => `/app/${ filepath }`;
            const config = makeConfig();

            const result = readConfig(config, 'development', { resolveFilepath, defaults: makeDefaults() });

            assertEqual('test-app', result.name);
            assertEqual('development', result.environment);
            assertEqual(resolveFilepath, result.resolveFilepath);
            assertEqual('http://localhost:8787', result.env.database.url);
            assertEqual('sqlite', result.env.STORE.kind);
            assertUndefined(result.environments);
        });
    });

    describe('validation', ({ it }) => {
        it('throws an AssertionError when defaults is not a plain object', () => {
            for (const defaults of [ [], 'defaults', null, 1, () => {} ]) {
                const caught = catchError(() => readConfig(makeConfig(), 'development', { defaults }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('options.defaults', caught.message);
            }
        });

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

        it('throws an OperationalError when the selected environment is inherited', () => {
            const environments = Object.create({
                preview: {
                    database: {
                        url: 'https://database.example.com',
                    },
                },
            });
            const config = makeConfig({ environments });
            const caught = catchError(() => readConfig(config, 'preview'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertMatches('"preview" environment', caught.message);
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
