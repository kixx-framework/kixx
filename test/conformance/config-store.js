/**
 * ConfigStore port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testConfigStoreConformance } from '../../../conformance/config-store.js';
 *
 *   testConfigStoreConformance(() => new JSModuleConfigStore({ config: {}, secrets: {} }));
 *
 * The factory must return a store instance that is ready to use. It will be called
 * once per describe block — pass a fresh instance each time.
 *
 * @module conformance/config-store
 */
import { describe } from 'kixx-test';
import { assertEqual, assert } from 'kixx-assert';


/**
 * Registers ConfigStore port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/config-store.js').ConfigStore} createStore
 *   Factory that returns a fresh ConfigStore instance ready to use.
 */
export function testConfigStoreConformance(createStore) {

    describe('ConfigStore port - on() must return `this` for chaining', ({ it }) => {
        it('returns the store instance', () => {
            const store = createStore();
            const result = store.on('update:config', () => {});
            assertEqual(store, result);
        });
    });

    describe('ConfigStore port - on() must return `this` when registering update:secrets', ({ it }) => {
        it('returns the store instance', () => {
            const store = createStore();
            const result = store.on('update:secrets', () => {});
            assertEqual(store, result);
        });
    });

    describe('ConfigStore port - loadConfig() must emit update:config before the Promise resolves', ({ before, it }) => {
        let emittedBeforeResolve = false;

        before(async () => {
            const store = createStore();
            store.on('update:config', () => {
                emittedBeforeResolve = true;
            });
            await store.loadConfig();
        });

        it('emitted before resolving', () => {
            assert(emittedBeforeResolve);
        });
    });

    describe('ConfigStore port - loadConfig() must emit update:config with an Object', ({ before, it }) => {
        let emittedValue;

        before(async () => {
            const store = createStore();
            store.on('update:config', (value) => {
                emittedValue = value;
            });
            await store.loadConfig();
        });

        it('emitted value is an Object', () => {
            assertEqual('object', typeof emittedValue);
            assert(emittedValue !== null);
        });
    });

    describe('ConfigStore port - loadSecrets() must emit update:secrets before the Promise resolves', ({ before, it }) => {
        let emittedBeforeResolve = false;

        before(async () => {
            const store = createStore();
            store.on('update:secrets', () => {
                emittedBeforeResolve = true;
            });
            await store.loadSecrets();
        });

        it('emitted before resolving', () => {
            assert(emittedBeforeResolve);
        });
    });

    describe('ConfigStore port - loadSecrets() must emit update:secrets with an Object', ({ before, it }) => {
        let emittedValue;

        before(async () => {
            const store = createStore();
            store.on('update:secrets', (value) => {
                emittedValue = value;
            });
            await store.loadSecrets();
        });

        it('emitted value is an Object', () => {
            assertEqual('object', typeof emittedValue);
            assert(emittedValue !== null);
        });
    });
}
