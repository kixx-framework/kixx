import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotMatches } from 'kixx-assert';

import { bootApplication } from '../../../kixx/context/boot-application.js';
import ApplicationContext from '../../../kixx/context/application-context.js';


function makeLoggerWriter() {
    return class LoggerWriter {
        write() {}
    };
}

function makeConfig() {
    return {
        name: 'test-app',
        environment: 'test',
        env: {
            LOGGER: { level: 'error' },
        },
    };
}

function makeEnv() {
    return { BUILD_ID: 'build-123' };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

// A logger writer class that records each entry it is asked to write.
function makeRecordingLoggerWriter(entries) {
    return class LoggerWriter {
        write(_name, _levelCode, level, message, info, error) {
            entries.push({ level, message, info, error });
        }
    };
}

function boot(overrides) {
    return bootApplication(Object.assign({
        env: makeEnv(),
        config: makeConfig(),
        LoggerWriter: makeLoggerWriter(),
        plugins: new Map(),
        app: {},
    }, overrides));
}


describe('bootApplication', ({ it, describe }) => {

    it('returns an ApplicationContext and logger', () => {
        const { appContext, logger } = bootApplication({
            env: makeEnv(),
            config: makeConfig(),
            LoggerWriter: makeLoggerWriter(),
            plugins: new Map(),
            app: {},
        });

        assert(appContext instanceof ApplicationContext);
        assert(logger, 'expected a logger to be returned');
    });

    // CORE-2: boot needs no LOGGER block.
    it('returns a logger at INFO when the config has no LOGGER block', () => {
        const config = makeConfig();
        delete config.env.LOGGER;

        const { logger } = boot({ config });

        assertEqual('INFO', logger.level);
    });

    it('returns a logger at INFO when the LOGGER block has no level', () => {
        const config = makeConfig();
        config.env.LOGGER = {};

        const { logger } = boot({ config });

        assertEqual('INFO', logger.level);
    });

    it('uses the configured log level', () => {
        const { logger } = boot();

        assertEqual('ERROR', logger.level);
    });

    it('throws when the configured log level is invalid', () => {
        const config = makeConfig();
        config.env.LOGGER = { level: 'LOUD' };

        const caught = catchError(() => boot({ config }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('"LOUD" is an invalid level name', caught.message);
    });

    it('runs every plugin register() before any plugin initialize(), then app hooks, then finalizes the logger', () => {
        const calls = [];

        const pluginA = {
            register: () => calls.push('pluginA.register'),
            initialize: () => calls.push('pluginA.initialize'),
        };

        const pluginB = {
            register: () => calls.push('pluginB.register'),
            initialize: () => calls.push('pluginB.initialize'),
        };

        const plugins = new Map([
            [ 'pluginA', pluginA ],
            [ 'pluginB', pluginB ],
        ]);

        const app = {
            register: () => calls.push('app.register'),
            initialize: () => calls.push('app.initialize'),
        };

        const { logger } = bootApplication({
            env: makeEnv(),
            config: makeConfig(),
            LoggerWriter: makeLoggerWriter(),
            plugins,
            app,
        });

        assertEqual('pluginA.register', calls[0]);
        assertEqual('pluginB.register', calls[1]);
        assertEqual('pluginA.initialize', calls[2]);
        assertEqual('pluginB.initialize', calls[3]);
        assertEqual('app.register', calls[4]);
        assertEqual('app.initialize', calls[5]);

        // finalize() must run after every register()/initialize() call, and a
        // finalized logger refuses to create further children.
        const caught = catchError(() => logger.createChild('late'));
        assert(caught, 'expected createChild() to throw on a finalized logger');
    });

    it('tolerates plugins and an app that omit either hook', () => {
        const plugins = new Map([
            [ 'registerOnly', { register: () => {} } ],
            [ 'initializeOnly', { initialize: () => {} } ],
            [ 'neither', {} ],
        ]);

        const { appContext } = bootApplication({
            env: makeEnv(),
            config: makeConfig(),
            LoggerWriter: makeLoggerWriter(),
            plugins,
            app: {},
        });

        assert(appContext instanceof ApplicationContext);
    });

    describe('with declared secrets', ({ it }) => {
        const secrets = {
            required: [ 'ZEBRA_SECRET', 'ALPHA_SECRET' ],
            optional: [ 'OPTIONAL_SECRET' ],
            requiredOutsideDevelopment: [],
        };

        it('boots when every required secret is in the environment', () => {
            const calls = [];
            const plugins = new Map([ [ 'pluginA', { register: () => calls.push('pluginA.register') } ] ]);
            const env = Object.assign(makeEnv(), { ZEBRA_SECRET: 'z-value', ALPHA_SECRET: 'a-value' });

            const { appContext } = boot({ env, plugins, secrets });

            assert(appContext instanceof ApplicationContext);
            assertEqual('pluginA.register', calls.join(','));
        });

        it('throws before the logger writer is built or any plugin is registered', () => {
            const calls = [];

            class LoggerWriter {
                constructor() {
                    calls.push('LoggerWriter');
                }

                write() {}
            }

            const plugins = new Map([
                [ 'pluginA', {
                    register: () => calls.push('pluginA.register'),
                    initialize: () => calls.push('pluginA.initialize'),
                } ],
            ]);

            const app = { register: () => calls.push('app.register') };
            const env = Object.assign(makeEnv(), { ZEBRA_SECRET: 'z-value-5f2c' });

            const caught = catchError(() => boot({ env, LoggerWriter, plugins, app, secrets }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(
                'Missing required environment secrets: ALPHA_SECRET. Every declared secret is listed in example.env.secrets.',
                caught.message,
            );
            assertNotMatches('z-value-5f2c', caught.message);
            assertEqual(0, calls.length);
        });

        it('names every missing secret in one error', () => {
            const caught = catchError(() => boot({ secrets }));

            assert(caught, 'expected an error to be thrown');
            assertEqual(
                'Missing required environment secrets: ALPHA_SECRET, ZEBRA_SECRET. Every declared secret is listed in example.env.secrets.',
                caught.message,
            );
        });
    });

    describe('with a secret required outside development', ({ it }) => {
        const secrets = {
            required: [],
            optional: [],
            requiredOutsideDevelopment: [ 'OUTSIDE_SECRET' ],
        };

        function configFor(environment) {
            return Object.assign(makeConfig(), { environment });
        }

        it('boots in development without it', () => {
            const { appContext } = boot({ config: configFor('development'), secrets });

            assert(appContext instanceof ApplicationContext);
        });

        it('fails in production without it, naming it and holding no value', () => {
            const env = Object.assign(makeEnv(), { OTHER_SECRET: 'o-value-3a9d' });
            const caught = catchError(() => boot({ env, config: configFor('production'), secrets }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual(
                'Missing required environment secrets: OUTSIDE_SECRET. Every declared secret is listed in example.env.secrets.',
                caught.message,
            );
            assertNotMatches('o-value-3a9d', caught.message);
        });

        it('boots in production with it', () => {
            const env = Object.assign(makeEnv(), { OUTSIDE_SECRET: 'present' });
            const { appContext } = boot({ env, config: configFor('production'), secrets });

            assert(appContext instanceof ApplicationContext);
        });
    });

    describe('with declared template helpers', ({ it }) => {
        // A plugin that registers a stand-in HyperviewService, which records
        // what boot asks it to compare and when.
        function makeHyperviewPlugin(calls) {
            return {
                register(context) {
                    context.registerService('HyperviewService', {
                        reportTemplateHelperDifferences(declaredNames) {
                            // The real service logs here. A finalized logger
                            // refuses to create a child, so this throws if
                            // the comparison runs after logger.finalize().
                            context.logger.createChild('during-report');

                            calls.push(`report:${ declaredNames.join(',') }`);
                            return { undeclared: [ 'shout' ], unregistered: [] };
                        },
                    });
                },
            };
        }

        it('compares them after the app\'s initialize() and before the logger is finalized', () => {
            const calls = [];

            const plugins = new Map([
                [ 'hyperview', makeHyperviewPlugin(calls) ],
                [ 'visits', { initialize: () => calls.push('visits.initialize') } ],
            ]);

            const app = { initialize: () => calls.push('app.initialize') };

            boot({ plugins, app, templateHelpers: [ 'each', 'if' ] });

            assertEqual('visits.initialize | app.initialize | report:each,if', calls.join(' | '));
        });

        it('boots when the comparison finds a difference', () => {
            const calls = [];
            const plugins = new Map([ [ 'hyperview', makeHyperviewPlugin(calls) ] ]);

            const { appContext } = boot({ plugins, templateHelpers: [] });

            assert(appContext instanceof ApplicationContext);
            assertEqual(1, calls.length);
        });

        it('compares nothing when the option is absent, with or without a HyperviewService', () => {
            const calls = [];
            const plugins = new Map([ [ 'hyperview', makeHyperviewPlugin(calls) ] ]);

            boot({ plugins });
            boot();

            assertEqual(0, calls.length);
        });

        it('throws an AssertionError when the option is given and HyperviewService is not registered', () => {
            const caught = catchError(() => boot({ templateHelpers: [] }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('HyperviewService', caught.message);
        });
    });

    describe('start', ({ it }) => {
        it('runs each start() hook in plugin order, then the app, awaiting each before the next', async () => {
            const calls = [];

            function makeSlowStart(name) {
                return async () => {
                    calls.push(`${ name }.start`);
                    await Promise.resolve();
                    await Promise.resolve();
                    calls.push(`${ name }.started`);
                };
            }

            const plugins = new Map([
                [ 'pluginA', { start: makeSlowStart('pluginA') } ],
                [ 'noHooks', {} ],
                [ 'pluginB', { start: makeSlowStart('pluginB') } ],
            ]);

            const { start } = boot({ plugins, app: { start: makeSlowStart('app') } });

            // Booting must not start anything by itself.
            assertEqual(0, calls.length);

            await start();

            assertEqual(
                'pluginA.start,pluginA.started,pluginB.start,pluginB.started,app.start,app.started',
                calls.join(','),
            );
        });

        it('passes the application context and onUnexpectedError to each hook', async () => {
            const received = [];
            const onUnexpectedError = () => {};

            const plugins = new Map([
                [ 'pluginA', { start: (context, options) => received.push({ context, options }) } ],
            ]);

            const app = { start: (context, options) => received.push({ context, options }) };

            const { appContext, start } = boot({ plugins, app });

            await start({ onUnexpectedError });

            assertEqual(2, received.length);

            for (const { context, options } of received) {
                assertEqual(appContext, context);
                assertEqual(onUnexpectedError, options.onUnexpectedError);
            }
        });

        it('gives the hooks a function that does nothing when onUnexpectedError is absent', async () => {
            let received;
            const plugins = new Map([
                [ 'pluginA', { start: (_context, options) => {
                    received = options.onUnexpectedError;
                } } ],
            ]);

            const { start } = boot({ plugins });

            await start();

            assertEqual('function', typeof received);
            assertEqual(undefined, received(new Error('test')));
        });

        it('stops at a rejecting hook and rejects with the same error', async () => {
            const calls = [];
            const failure = new Error('pluginB failed to start');

            const plugins = new Map([
                [ 'pluginA', {
                    start: () => calls.push('pluginA.start'),
                    stop: () => calls.push('pluginA.stop'),
                } ],
                [ 'pluginB', {
                    start: async () => {
                        calls.push('pluginB.start');
                        throw failure;
                    },
                } ],
                [ 'pluginC', { start: () => calls.push('pluginC.start') } ],
            ]);

            const { start } = boot({ plugins, app: { start: () => calls.push('app.start') } });

            const caught = await catchAsyncError(() => start());

            assertEqual(failure, caught);

            // The caller decides whether to stop; start() never does.
            assertEqual('pluginA.start,pluginB.start', calls.join(','));
        });

        it('rejects with the same error when a hook throws synchronously', async () => {
            const failure = new Error('pluginA failed to start');
            const plugins = new Map([
                [ 'pluginA', { start: () => {
                    throw failure;
                } } ],
            ]);

            const { start } = boot({ plugins });

            assertEqual(failure, await catchAsyncError(() => start()));
        });

        it('rejects with an AssertionError when called a second time', async () => {
            const calls = [];
            const plugins = new Map([ [ 'pluginA', { start: () => calls.push('pluginA.start') } ] ]);

            const { start } = boot({ plugins });

            await start();

            const caught = await catchAsyncError(() => start());

            assert(caught, 'expected the second call to reject');
            assertEqual('AssertionError', caught.name);
            assertEqual(1, calls.length);
        });
    });

    describe('stop', ({ it }) => {
        it('runs each stop() hook in reverse order, with the app first', async () => {
            const calls = [];
            const received = [];

            function makeSlowStop(name) {
                return async (context) => {
                    received.push(context);
                    calls.push(`${ name }.stop`);
                    await Promise.resolve();
                    await Promise.resolve();
                    calls.push(`${ name }.stopped`);
                };
            }

            const plugins = new Map([
                [ 'pluginA', { stop: makeSlowStop('pluginA') } ],
                [ 'noHooks', {} ],
                [ 'pluginB', { stop: makeSlowStop('pluginB') } ],
            ]);

            const { appContext, start, stop } = boot({ plugins, app: { stop: makeSlowStop('app') } });

            await start();
            await stop();

            assertEqual(
                'app.stop,app.stopped,pluginB.stop,pluginB.stopped,pluginA.stop,pluginA.stopped',
                calls.join(','),
            );
            assertEqual(3, received.length);
            assert(received.every((context) => context === appContext), 'expected each hook to get the context');
        });

        it('continues past a failing hook and logs it once with the module name', async () => {
            const calls = [];
            const entries = [];
            const failure = new Error('pluginB failed to stop');

            const plugins = new Map([
                [ 'pluginA', { stop: () => calls.push('pluginA.stop') } ],
                [ 'pluginB', {
                    stop: async () => {
                        calls.push('pluginB.stop');
                        throw failure;
                    },
                } ],
            ]);

            const { stop } = boot({
                LoggerWriter: makeRecordingLoggerWriter(entries),
                plugins,
                app: { stop: () => calls.push('app.stop') },
            });

            await stop();

            assertEqual('app.stop,pluginB.stop,pluginA.stop', calls.join(','));
            assertEqual(1, entries.length);
            assertEqual('ERROR', entries[0].level);
            assertEqual('error stopping plugin during shutdown', entries[0].message);
            assertEqual('pluginB', entries[0].info.name);
            assertEqual(failure, entries[0].error);
        });

        it('logs a failing app hook under the name "app"', async () => {
            const entries = [];

            const { stop } = boot({
                LoggerWriter: makeRecordingLoggerWriter(entries),
                app: { stop: () => {
                    throw new Error('app failed to stop');
                } },
            });

            await stop();

            assertEqual(1, entries.length);
            assertEqual('app', entries[0].info.name);
        });

        it('runs when start() was never called', async () => {
            const calls = [];
            const plugins = new Map([
                [ 'pluginA', {
                    start: () => calls.push('pluginA.start'),
                    stop: () => calls.push('pluginA.stop'),
                } ],
            ]);

            const { stop } = boot({ plugins });

            await stop();

            assertEqual('pluginA.stop', calls.join(','));
        });

        it('runs for every module after a start() hook failed', async () => {
            const calls = [];
            const plugins = new Map([
                [ 'pluginA', { stop: () => calls.push('pluginA.stop') } ],
                [ 'pluginB', {
                    start: () => {
                        throw new Error('pluginB failed to start');
                    },
                    stop: () => calls.push('pluginB.stop'),
                } ],
                [ 'pluginC', { stop: () => calls.push('pluginC.stop') } ],
            ]);

            const { start, stop } = boot({ plugins });

            await catchAsyncError(() => start());
            await stop();

            assertEqual('pluginC.stop,pluginB.stop,pluginA.stop', calls.join(','));
        });

        it('does nothing when called a second time', async () => {
            const calls = [];
            const plugins = new Map([ [ 'pluginA', { stop: () => calls.push('pluginA.stop') } ] ]);

            const { stop } = boot({ plugins });

            await stop();
            await stop();

            assertEqual(1, calls.length);
        });

        it('does not close the application context', async () => {
            const calls = [];
            const plugins = new Map([
                [ 'pluginA', {
                    register: (context) => {
                        context.registerService('Store', { close: () => calls.push('Store.close') });
                    },
                    stop: () => calls.push('pluginA.stop'),
                } ],
            ]);

            const { appContext, stop } = boot({ plugins });

            await stop();

            assertEqual('pluginA.stop', calls.join(','));

            await appContext.close();

            assertEqual('pluginA.stop,Store.close', calls.join(','));
        });
    });
});
