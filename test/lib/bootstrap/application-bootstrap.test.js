import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import ApplicationBootstrap from '../../../lib/bootstrap/application-bootstrap.js';
import { testPluginLifecycleConformance } from '../../conformance/plugin.js';


function createMockBootstrap() {
    return {
        applicationDirectory: '/app',
        createConfigStore() {
            return null;
        },
        createHttpRoutesStore() {
            return null;
        },
        getPrintWriter() {
            return null;
        },
    };
}

function createAppBootstrap() {
    return new ApplicationBootstrap({
        environment: 'development',
        bootstrap: createMockBootstrap(),
    });
}

testPluginLifecycleConformance((plugins, applicationContext) => {
    return createAppBootstrap().loadPlugins(plugins, applicationContext);
});

describe('ApplicationBootstrap#loadPlugins() when a plugin does not define register()', ({ before, it }) => {
    const lifecycleEvents = [];
    const plugins = new Map([
        [ 'alpha', {
            async initialize() {
                lifecycleEvents.push('initialize:alpha');
            },
        }],
        [ 'beta', {
            register() {
                lifecycleEvents.push('register:beta');
            },
            async initialize() {
                lifecycleEvents.push('initialize:beta');
            },
        }],
    ]);

    let caughtError;

    before(async () => {
        try {
            await createAppBootstrap().loadPlugins(plugins, {});
        } catch (err) {
            caughtError = err;
        }
    });

    it('does not throw', () => {
        assertEqual(undefined, caughtError);
    });

    it('skips register for that plugin and calls register on plugins that have it', () => {
        assertEqual('register:beta', lifecycleEvents[0]);
    });

    it('still initializes all plugins', () => {
        assertEqual('initialize:alpha', lifecycleEvents[1]);
        assertEqual('initialize:beta', lifecycleEvents[2]);
    });
});

describe('ApplicationBootstrap#loadPlugins() when a plugin does not define initialize()', ({ before, it }) => {
    const lifecycleEvents = [];
    const plugins = new Map([
        [ 'alpha', {
            register() {
                lifecycleEvents.push('register:alpha');
            },
        }],
        [ 'beta', {
            register() {
                lifecycleEvents.push('register:beta');
            },
            async initialize() {
                lifecycleEvents.push('initialize:beta');
            },
        }],
    ]);

    let caughtError;

    before(async () => {
        try {
            await createAppBootstrap().loadPlugins(plugins, {});
        } catch (err) {
            caughtError = err;
        }
    });

    it('does not throw', () => {
        assertEqual(undefined, caughtError);
    });

    it('registers all plugins', () => {
        assertEqual('register:alpha', lifecycleEvents[0]);
        assertEqual('register:beta', lifecycleEvents[1]);
    });

    it('skips initialize for that plugin and calls initialize on plugins that have it', () => {
        assertEqual('initialize:beta', lifecycleEvents[2]);
    });
});

describe('ApplicationBootstrap#close() when loadPlugins() has not been called', ({ before, it }) => {
    let caughtError;

    before(async () => {
        try {
            await createAppBootstrap().close();
        } catch (err) {
            caughtError = err;
        }
    });

    it('does not throw', () => {
        assertEqual(undefined, caughtError);
    });
});

describe('ApplicationBootstrap#close() when all plugins define close()', ({ before, it }) => {
    const closeCalls = [];
    const plugins = new Map([
        [ 'alpha', { async close() {
            closeCalls.push('alpha');
        } }],
        [ 'beta', { async close() {
            closeCalls.push('beta');
        } }],
        [ 'gamma', { async close() {
            closeCalls.push('gamma');
        } }],
    ]);

    before(async () => {
        const appBootstrap = createAppBootstrap();
        await appBootstrap.loadPlugins(plugins, {});
        await appBootstrap.close();
    });

    it('calls close() on each plugin in insertion order', () => {
        assertEqual(3, closeCalls.length);
        assertEqual('alpha', closeCalls[0]);
        assertEqual('beta', closeCalls[1]);
        assertEqual('gamma', closeCalls[2]);
    });
});

describe('ApplicationBootstrap#close() when some plugins do not define close()', ({ before, it }) => {
    const closeCalls = [];
    const plugins = new Map([
        [ 'alpha', { async close() {
            closeCalls.push('alpha');
        } }],
        [ 'beta', {}],
        [ 'gamma', { async close() {
            closeCalls.push('gamma');
        } }],
    ]);

    before(async () => {
        const appBootstrap = createAppBootstrap();
        await appBootstrap.loadPlugins(plugins, {});
        await appBootstrap.close();
    });

    it('skips plugins without close() and calls close() on those that have it', () => {
        assertEqual(2, closeCalls.length);
        assertEqual('alpha', closeCalls[0]);
        assertEqual('gamma', closeCalls[1]);
    });
});

describe('ApplicationBootstrap#close() when a plugin close() throws', ({ before, it }) => {
    const closeCalls = [];
    const alphaError = new Error('alpha close failed');
    const gammaError = new Error('gamma close failed');
    const plugins = new Map([
        [ 'alpha', { async close() {
            closeCalls.push('alpha');
            throw alphaError;
        } }],
        [ 'beta', { async close() {
            closeCalls.push('beta');
        } }],
        [ 'gamma', { async close() {
            closeCalls.push('gamma');
            throw gammaError;
        } }],
    ]);

    let caughtError;

    before(async () => {
        const appBootstrap = createAppBootstrap();
        await appBootstrap.loadPlugins(plugins, {});
        try {
            await appBootstrap.close();
        } catch (err) {
            caughtError = err;
        }
    });

    it('still calls close() on all plugins', () => {
        assertEqual(3, closeCalls.length);
        assertEqual('alpha', closeCalls[0]);
        assertEqual('beta', closeCalls[1]);
        assertEqual('gamma', closeCalls[2]);
    });

    it('throws an AggregateError', () => {
        assertEqual('AggregateError', caughtError.name);
    });

    it('includes all errors in AggregateError.errors', () => {
        assertEqual(2, caughtError.errors.length);
        assertEqual(alphaError, caughtError.errors[0]);
        assertEqual(gammaError, caughtError.errors[1]);
    });
});

describe('ApplicationBootstrap#createHttpServer()', ({ before, it }) => {
    const mockServer = {};
    const mockApplicationContext = {};
    const mockBootstrap = {
        applicationDirectory: '/app',
        createConfigStore() {
            return null;
        },
        createHttpRoutesStore() {
            return null;
        },
        getPrintWriter() {
            return null;
        },
        createHttpServer: sinon.fake.returns(mockServer),
    };

    let result;

    before(() => {
        const appBootstrap = new ApplicationBootstrap({
            environment: 'development',
            bootstrap: mockBootstrap,
        });
        result = appBootstrap.createHttpServer(mockApplicationContext, 3000);
    });

    it('delegates to bootstrap with applicationContext and port', () => {
        assertEqual(1, mockBootstrap.createHttpServer.callCount);
        assertEqual(mockApplicationContext, mockBootstrap.createHttpServer.firstCall.args[0]);
        assertEqual(3000, mockBootstrap.createHttpServer.firstCall.args[1]);
    });

    it('returns the server from bootstrap', () => {
        assertEqual(mockServer, result);
    });
});

describe('ApplicationBootstrap#createHttpRouter()', ({ before, it }) => {
    const mockStore = {};
    const mockApplicationContext = {
        getHttpRouterRegistries: sinon.fake.returns({
            middleware: new Map(),
            requestHandlers: new Map(),
            errorHandlers: new Map(),
        }),
    };
    const mockBootstrap = {
        applicationDirectory: '/app',
        createConfigStore() {
            return null;
        },
        createHttpRoutesStore: sinon.fake.returns(mockStore),
        getPrintWriter() {
            return null;
        },
    };

    let router;
    const vhostsConfigs = [{ name: 'default', routes: [] }];

    before(() => {
        const appBootstrap = new ApplicationBootstrap({
            environment: 'development',
            bootstrap: mockBootstrap,
        });
        router = appBootstrap.createHttpRouter(mockApplicationContext, vhostsConfigs);
    });

    it('loads router registries from application context', () => {
        assertEqual(1, mockApplicationContext.getHttpRouterRegistries.callCount);
    });

    it('creates the routes store from vhost configs', () => {
        assertEqual(1, mockBootstrap.createHttpRoutesStore.callCount);
        assertEqual(vhostsConfigs, mockBootstrap.createHttpRoutesStore.firstCall.args[0]);
    });

    it('returns an HttpRouter instance', () => {
        assertEqual('HttpRouter', router.constructor.name);
    });
});
