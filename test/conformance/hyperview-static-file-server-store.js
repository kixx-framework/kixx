/**
 * HyperviewStaticFileServerStore port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testHyperviewStaticFileServerStoreConformance } from '../../../../conformance/hyperview-static-file-server-store.js';
 *
 *   testHyperviewStaticFileServerStoreConformance(() => {
 *       // Return a store configured so no static files exist.
 *       // For filesystem-based adapters, stub getFileStats to return null.
 *       const fileSystem = {
 *           getFileStats: sinon.stub().resolves(null),
 *           createReadStream: sinon.stub().returns(null),
 *       };
 *       return new StaticFileServerStore({ publicDirectory: '/public', fileSystem });
 *   });
 *
 * The factory must return a store where no static files exist. It will be called
 * once per describe block — return a fresh instance each time.
 *
 * @module conformance/hyperview-static-file-server-store
 */
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';


const MISSING_PATHNAME = '/conformance-test/does-not-exist.css';


/**
 * Registers HyperviewStaticFileServerStore port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/hyperview-static-file-server-store.js').HyperviewStaticFileServerStore} createStore
 *   Factory that returns a store where no static files exist.
 * @param {Object} [options]
 * @param {function(): import('../../lib/ports/hyperview-static-file-server-store.js').HyperviewStaticFileServerStore} [options.createExistingFileStore]
 *   Factory that returns a store where `existingPathname` resolves to a real file descriptor.
 * @param {string} [options.existingPathname]
 *   Pathname expected to exist in the store returned by createExistingFileStore().
 */
export function testHyperviewStaticFileServerStoreConformance(createStore, options = {}) {

    describe('HyperviewStaticFileServerStore port - getFile() must resolve with null for a missing file', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.getFile(MISSING_PATHNAME);
        });

        it('resolves with null', () => {
            assertEqual(null, result);
        });
    });

    describe('HyperviewStaticFileServerStore port - getFile() must not reject for a missing file', ({ before, it }) => {
        let caughtError;

        before(async () => {
            const store = createStore();
            try {
                await store.getFile(MISSING_PATHNAME);
            } catch (err) {
                caughtError = err;
            }
        });

        it('does not throw', () => {
            assertEqual(undefined, caughtError);
        });
    });

    if (options.createExistingFileStore && options.existingPathname) {
        describe('HyperviewStaticFileServerStore port - getFile() returns a usable file descriptor', ({ before, it }) => {
            let file;

            before(async () => {
                const store = options.createExistingFileStore();
                file = await store.getFile(options.existingPathname);
            });

            it('returns an object', () => {
                assertEqual('object', typeof file);
            });

            it('exposes a sizeBytes number', () => {
                assertEqual('number', typeof file.sizeBytes);
            });

            it('exposes a modifiedDate', () => {
                assertEqual('Date', file.modifiedDate.constructor.name);
            });

            it('exposes a createReadStream function', () => {
                assertEqual('function', typeof file.createReadStream);
            });

            it('exposes a computeHash function', () => {
                assertEqual('function', typeof file.computeHash);
            });
        });
    }
}
