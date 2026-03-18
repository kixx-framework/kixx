/**
 * HyperviewTemplateStore port — the abstraction for loading base templates,
 * partial templates, and helper files used by HyperviewService to compile
 * and render pages.
 *
 * Implement this interface to support different template sources: local
 * filesystem directories (node-local-store/TemplateStore), CDN-hosted
 * templates, database-backed template systems, etc.
 *
 * ## Invariants
 * - getBaseTemplate() MUST resolve with a HyperviewSourceFile when the
 *   template ID exists, or null when it does not; never reject
 * - loadPartialFiles() MUST resolve with an Array of HyperviewSourceFile;
 *   return an empty Array when no partials exist; never reject
 * - loadHelperFiles() MUST resolve with an Array of HyperviewHelperFile;
 *   return an empty Array when no helpers exist; never reject
 * - loadPartialFiles() and loadHelperFiles() may be called once at startup
 *   and their results cached by the consumer; implementations SHOULD be
 *   safe to call more than once
 *
 * @module ports/hyperview-template-store
 */

/**
 * @typedef {import('./hyperview-page-store.js').HyperviewSourceFile} HyperviewSourceFile
 */

/**
 * @typedef {import('./hyperview-page-store.js').HyperviewHelperFile} HyperviewHelperFile
 */

/**
 * @typedef {Object} HyperviewTemplateStore
 * @property {function(string): Promise<HyperviewSourceFile|null>} getBaseTemplate
 *   Loads the base template source file for the given template ID.
 *   MUST resolve with a HyperviewSourceFile or null; never reject.
 * @property {function(): Promise<HyperviewSourceFile[]>} loadPartialFiles
 *   Loads all partial template source files.
 *   MUST resolve with an Array (empty when no partials exist); never reject.
 * @property {function(): Promise<HyperviewHelperFile[]>} loadHelperFiles
 *   Loads all custom template helper files.
 *   MUST resolve with an Array (empty when no helpers exist); never reject.
 */
