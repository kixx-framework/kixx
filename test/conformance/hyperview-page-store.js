/**
 * HyperviewPageStore port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testHyperviewPageStoreConformance } from '../../../../conformance/hyperview-page-store.js';
 *
 *   testHyperviewPageStoreConformance(() => {
 *       // Return a store configured so that all pathnames return "not found".
 *       // For filesystem-based adapters, stub all filesystem methods to return
 *       // null / empty arrays so no pages appear to exist.
 *       const fileSystem = {
 *           getFileStats: sinon.stub().resolves(null),
 *           readDirectory: sinon.stub().resolves([]),
 *           readJSONFile: sinon.stub().resolves(null),
 *           readUtf8File: sinon.stub().resolves(null),
 *       };
 *       return new PageStore({ directory: '/pages', fileSystem });
 *   });
 *
 * The factory must return a store where no pages exist for any pathname. It will
 * be called once per describe block — return a fresh instance each time.
 *
 * @module conformance/hyperview-page-store
 */
import { describe } from 'kixx-test';
import { assertEqual, assert, assertArray, isPlainObject } from 'kixx-assert';


const MISSING_PATHNAME = '/conformance-test/does-not-exist';


/**
 * Registers HyperviewPageStore port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/hyperview-page-store.js').HyperviewPageStore} createStore
 *   Factory that returns a store where no pages exist for any pathname.
 */
export function testHyperviewPageStoreConformance(createStore) {

    describe('HyperviewPageStore port - doesPageExist() must resolve with a boolean for a missing page', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.doesPageExist(MISSING_PATHNAME);
        });

        it('resolves with false', () => {
            assertEqual(false, result);
        });
    });

    describe('HyperviewPageStore port - getPageData() must resolve with a plain Object for a missing page', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.getPageData(MISSING_PATHNAME);
        });

        it('resolves with a plain Object', () => {
            assert(isPlainObject(result));
        });
    });

    describe('HyperviewPageStore port - getPageTemplate() must resolve with null for a missing page', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.getPageTemplate(MISSING_PATHNAME);
        });

        it('resolves with null', () => {
            assertEqual(null, result);
        });
    });

    describe('HyperviewPageStore port - getMarkdownContent() must resolve with an Array for a missing page', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.getMarkdownContent(MISSING_PATHNAME);
        });

        it('resolves with an Array', () => {
            assertArray(result);
        });
    });
}
