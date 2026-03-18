/**
 * Plugin port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testPluginConformance } from '../../../conformance/plugin.js';
 *
 *   testPluginConformance(() => ({
 *       register: myPlugin.register,
 *       initialize: myPlugin.initialize,
 *   }));
 *
 * The factory must return an object (or module namespace) with `register` and
 * `initialize` properties that are functions. For class-based plugins, pass an
 * instance; for module-based plugins (named exports), pass an object wrapping them.
 *
 * The mock ApplicationContext passed to register/initialize is a plain object
 * with no-op stubs. If your plugin requires specific context services, either
 * skip calling this conformance helper for the behavioral tests, or extend the
 * mock context in the factory before returning.
 *
 * @module conformance/plugin
 */
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';


function createMockApplicationContext() {
    return {
        config: {
            applicationDirectory: '/tmp/kixx-conformance-test',
        },
        registerService() {},
        getService() {
            return null;
        },
        registerRequestHandler() {},
        registerErrorHandler() {},
    };
}


/**
 * Registers Plugin port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/plugin.js').Plugin} createPlugin
 *   Factory that returns a fresh Plugin instance (or module-shaped object) ready to use.
 */
export function testPluginConformance(createPlugin) {

    describe('Plugin port - register() must be synchronous', ({ it }) => {
        it('does not return a Promise', () => {
            const plugin = createPlugin();
            const context = createMockApplicationContext();
            const result = plugin.register(context);
            // A synchronous function returns undefined or a non-Promise value.
            // An async function always returns a Promise.
            assert(!(result instanceof Promise));
        });
    });

    describe('Plugin port - initialize() must return a Promise', ({ before, it }) => {
        let result;

        before(() => {
            const plugin = createPlugin();
            const context = createMockApplicationContext();
            result = plugin.initialize(context);
            // Consume the promise so unhandled rejection warnings don't fire.
            // The conformance test only checks that a Promise is returned.
            if (result instanceof Promise) {
                result.catch(() => {});
            }
        });

        it('returns a Promise', () => {
            assert(result instanceof Promise);
        });
    });

    describe('Plugin port - register() must accept an ApplicationContext', ({ it }) => {
        it('does not throw when called with a mock context', () => {
            const plugin = createPlugin();
            const context = createMockApplicationContext();
            let caughtError;
            try {
                plugin.register(context);
            } catch (err) {
                caughtError = err;
            }
            assertEqual(undefined, caughtError);
        });
    });
}
