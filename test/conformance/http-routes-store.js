/**
 * HttpRoutesStore port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testHttpRoutesStoreConformance } from '../../../conformance/http-routes-store.js';
 *
 *   testHttpRoutesStoreConformance(() => new JSModuleHttpRoutesStore([]));
 *
 * The factory must return a store instance that is ready to use. It will be called
 * once per describe block — pass a fresh instance each time.
 *
 * @module conformance/http-routes-store
 */
import { describe } from 'kixx-test';
import { assertArray } from 'kixx-assert';


/**
 * Registers HttpRoutesStore port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/http-routes-store.js').HttpRoutesStore} createStore
 *   Factory that returns a fresh HttpRoutesStore instance ready to use.
 */
export function testHttpRoutesStoreConformance(createStore) {

    describe('HttpRoutesStore port - loadVirtualHosts() must resolve with an Array', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.loadVirtualHosts();
        });

        it('resolves with an Array', () => {
            assertArray(result);
        });
    });

    describe('HttpRoutesStore port - loadVirtualHosts() must be safe to call more than once', ({ before, it }) => {
        let firstResult;
        let secondResult;

        before(async () => {
            const store = createStore();
            firstResult = await store.loadVirtualHosts();
            secondResult = await store.loadVirtualHosts();
        });

        it('first call resolves with an Array', () => {
            assertArray(firstResult);
        });

        it('second call resolves with an Array', () => {
            assertArray(secondResult);
        });
    });
}
