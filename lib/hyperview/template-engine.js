import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';

export default class TemplateEngine {

    compileTemplate(templateId, source, customHelpers, partials) {
        const thisHelpers = this.#mergeHelpers(customHelpers);

        const tokens = tokenize(null, templateId, source);
        const tree = buildSyntaxTree(null, tokens);

        return createRenderFunction(null, thisHelpers, partials, tree);
    }

    #mergeHelpers(customHelpers) {
        const helpersCopy = new Map(helpers);

        for (const [ key, val ] of customHelpers) {
            helpersCopy.set(key, val);
        }

        return helpersCopy;
    }
}
