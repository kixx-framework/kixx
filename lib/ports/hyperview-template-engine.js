/**
 * HyperviewTemplateEngine port — the abstraction for compiling a template
 * source string into a reusable render function.
 *
 * Implement this interface to swap the underlying template language used by
 * HyperviewService: Handlebars (TemplateEngine), Mustache, Nunjucks, etc.
 *
 * ## Invariants
 * - compileTemplate() MUST return a synchronous render Function
 * - The returned render Function MUST accept a single plain Object of template
 *   data and return a rendered string
 * - Helpers and partials passed as Maps MUST be available by name inside the
 *   compiled template
 * - compileTemplate() MAY throw on invalid template syntax; the caller
 *   (HyperviewService) handles compilation errors
 *
 * @module ports/hyperview-template-engine
 */

/**
 * @typedef {Object} HyperviewTemplateEngine
 * @property {function(string, string, Map<string, Function>, Map<string, Function>): Function} compileTemplate
 *   Compiles a template source string into a render function.
 *
 *   Parameters:
 *   - `templateId` {string} — Unique identifier used for error messages and caching keys
 *   - `source` {string} — Raw template source string
 *   - `helpers` {Map<string, Function>} — Named helper functions available inside the template
 *   - `partials` {Map<string, Function>} — Named partial render functions available inside the template
 *
 *   Returns a render Function that accepts a plain Object of data and returns a rendered string.
 *   MAY throw when the source contains invalid template syntax.
 */
