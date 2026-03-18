import { describe } from 'kixx-test';
import { assertEqual, assertFunction } from 'kixx-assert';
import TemplateEngine from '../../../lib/hyperview/template-engine.js';
import { testHyperviewTemplateEngineConformance } from '../../conformance/hyperview-template-engine.js';


testHyperviewTemplateEngineConformance(() => new TemplateEngine());


describe('TemplateEngine#compileTemplate() with a static template', ({ it }) => {
    it('renders the static content unchanged', () => {
        const engine = new TemplateEngine();
        const render = engine.compileTemplate('test', 'hello world', new Map(), new Map());
        assertFunction(render);
        const result = render({});
        assertEqual('hello world', result);
    });
});
