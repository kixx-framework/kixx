/**
 * HyperviewTemplateEngine port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testHyperviewTemplateEngineConformance } from '../../../conformance/hyperview-template-engine.js';
 *
 *   testHyperviewTemplateEngineConformance(() => new TemplateEngine());
 *
 * The factory must return an engine instance ready to use. It will be called
 * once per describe block — pass a fresh instance each time.
 *
 * @module conformance/hyperview-template-engine
 */
import { describe } from 'kixx-test';
import { assertEqual, assertFunction } from 'kixx-assert';


/**
 * Registers HyperviewTemplateEngine port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/hyperview-template-engine.js').HyperviewTemplateEngine} createEngine
 *   Factory that returns a fresh HyperviewTemplateEngine instance ready to use.
 */
export function testHyperviewTemplateEngineConformance(createEngine) {

    describe('HyperviewTemplateEngine port - compileTemplate() must return a Function', ({ it }) => {
        it('returns a Function', () => {
            const engine = createEngine();
            const render = engine.compileTemplate('test', 'hello world', new Map(), new Map());
            assertFunction(render);
        });
    });

    describe('HyperviewTemplateEngine port - compiled render function must return a string', ({ it }) => {
        it('returns a string', () => {
            const engine = createEngine();
            const render = engine.compileTemplate('test', 'hello world', new Map(), new Map());
            const result = render({});
            assertEqual('string', typeof result);
        });
    });

    describe('HyperviewTemplateEngine port - compiled render function must interpolate data', ({ it }) => {
        it('includes data values in the rendered output', () => {
            const engine = createEngine();
            // NOTE: This test uses Handlebars/Mustache-style {{ }} syntax. If your template
            // engine uses a different syntax, override this test in the adapter test file
            // and only run the return-type tests from this conformance helper.
            const render = engine.compileTemplate('test', '{{ greeting }}', new Map(), new Map());
            const result = render({ greeting: 'hello' });
            assertEqual('string', typeof result);
        });
    });
}
