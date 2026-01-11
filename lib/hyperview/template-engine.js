import { tokenize, buildSyntaxTree, createRenderFunction, helpers } from '../template-engine/mod.js';

/**
 * Compiles template source code into renderable functions for the templating system.
 *
 * TemplateEngine processes template source strings through a compilation pipeline:
 * tokenization, syntax tree construction, and render function generation. It merges
 * built-in template helpers with custom helpers, allowing custom implementations to
 * override defaults. Compiled templates can be rendered with context data to produce
 * output strings.
 */
export default class TemplateEngine {

    /**
     * Compiles template source code into a renderable function.
     *
     * Processes the template source through tokenization and syntax tree construction,
     * then generates a render function that accepts context data and returns rendered output.
     * Custom helpers override built-in helpers when they share the same key.
     *
     * The returned function accepts a props object and returns a rendered template string.
     * @public
     * @param {string} templateId - Unique identifier for the template (used for error reporting)
     * @param {string} source - Template source code containing template syntax
     * @param {Map<string, Function>} customHelpers - Map of custom helper functions keyed by helper name
     * @param {Map<string, Function>} partials - Map of compiled partial templates keyed by partial name
     * @returns {Function} Render function that accepts props object and returns rendered template string
     */
    compileTemplate(templateId, source, customHelpers, partials) {
        // Merge built-in helpers with custom helpers, allowing custom helpers to override
        // built-in ones (e.g., custom 'format_date' overrides the default)
        const thisHelpers = this.#mergeHelpers(customHelpers);

        // Compilation pipeline: tokenize source -> build syntax tree -> create render function
        const tokens = tokenize(null, templateId, source);
        const tree = buildSyntaxTree(null, tokens);

        return createRenderFunction(null, thisHelpers, partials, tree);
    }

    /**
     * Merges built-in template helpers with custom helpers, allowing custom helpers to override defaults.
     *
     * Creates a copy of the built-in helpers map to avoid mutating the shared helpers reference,
     * then applies custom helpers which take precedence when keys match.
     * @param {Map<string, Function>} customHelpers - Map of custom helper functions to merge
     * @returns {Map<string, Function>} Merged helpers map with custom helpers overriding built-in ones
     */
    #mergeHelpers(customHelpers) {
        // Start with a copy of built-in helpers to avoid mutating the shared helpers map
        const helpersCopy = new Map(helpers);

        // Custom helpers override built-in helpers when they have the same key
        for (const [ key, val ] of customHelpers) {
            helpersCopy.set(key, val);
        }

        return helpersCopy;
    }
}
