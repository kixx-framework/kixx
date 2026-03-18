/**
 * HyperviewTemplateStore port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testHyperviewTemplateStoreConformance } from '../../../../conformance/hyperview-template-store.js';
 *
 *   testHyperviewTemplateStoreConformance(() => {
 *       // Return a store configured so all template directories are empty.
 *       // For filesystem-based adapters, stub filesystem methods to return
 *       // null / empty arrays so no templates or helpers appear to exist.
 *       const fileSystem = {
 *           readUtf8File: sinon.stub().resolves(null),
 *           readDirectory: sinon.stub().resolves([]),
 *           importAbsoluteFilepath: sinon.stub().resolves({}),
 *       };
 *       return new TemplateStore({
 *           helpersDirectory: '/helpers',
 *           partialsDirectory: '/partials',
 *           templatesDirectory: '/templates',
 *           fileSystem,
 *       });
 *   });
 *
 * The factory must return a store where no templates, partials, or helpers exist.
 * It will be called once per describe block — return a fresh instance each time.
 *
 * @module conformance/hyperview-template-store
 */
import { describe } from 'kixx-test';
import { assertEqual, assertArray } from 'kixx-assert';


const MISSING_TEMPLATE_ID = 'conformance-test/does-not-exist';


/**
 * Registers HyperviewTemplateStore port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/hyperview-template-store.js').HyperviewTemplateStore} createStore
 *   Factory that returns a store where no templates, partials, or helpers exist.
 */
export function testHyperviewTemplateStoreConformance(createStore) {

    describe('HyperviewTemplateStore port - getBaseTemplate() must resolve with null for a missing template', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.getBaseTemplate(MISSING_TEMPLATE_ID);
        });

        it('resolves with null', () => {
            assertEqual(null, result);
        });
    });

    describe('HyperviewTemplateStore port - loadPartialFiles() must resolve with an Array when no partials exist', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.loadPartialFiles();
        });

        it('resolves with an Array', () => {
            assertArray(result);
        });
    });

    describe('HyperviewTemplateStore port - loadHelperFiles() must resolve with an Array when no helpers exist', ({ before, it }) => {
        let result;

        before(async () => {
            const store = createStore();
            result = await store.loadHelperFiles();
        });

        it('resolves with an Array', () => {
            assertArray(result);
        });
    });

    describe('HyperviewTemplateStore port - loadPartialFiles() must be safe to call more than once', ({ before, it }) => {
        let firstResult;
        let secondResult;

        before(async () => {
            const store = createStore();
            firstResult = await store.loadPartialFiles();
            secondResult = await store.loadPartialFiles();
        });

        it('first call resolves with an Array', () => {
            assertArray(firstResult);
        });

        it('second call resolves with an Array', () => {
            assertArray(secondResult);
        });
    });
}
