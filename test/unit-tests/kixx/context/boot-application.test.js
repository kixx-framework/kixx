import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { bootApplication } from '../../../../src/kixx/context/boot-application.js';
import ApplicationContext from '../../../../src/kixx/context/application-context.js';


function makeLoggerWriter() {
    return class LoggerWriter {
        write() {}
    };
}

function makeConfig() {
    return {
        name: 'test-app',
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


describe('bootApplication', ({ it }) => {

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
});
