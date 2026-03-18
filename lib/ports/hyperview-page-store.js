/**
 * HyperviewPageStore port — the abstraction for loading page data, page
 * templates, and markdown content for a given URL pathname.
 *
 * Implement this interface to support different page sources: local
 * filesystem directories (node-local-store/PageStore), CMS APIs, databases,
 * etc. HyperviewService calls these methods during the request render pipeline.
 *
 * ## Invariants
 * - doesPageExist() MUST resolve with a boolean; never reject for a missing
 *   page (that is the expected "false" case, not an error)
 * - getPageData() MUST resolve with a plain Object; return an empty Object
 *   `{}` when no data file exists for the pathname
 * - getPageTemplate() MUST resolve with a HyperviewSourceFile when a template
 *   exists, or null when the pathname has no associated template
 * - getMarkdownContent() MUST resolve with an Array of HyperviewSourceFile;
 *   return an empty Array when no markdown files exist for the pathname
 * - All methods MUST be safe to call concurrently for different pathnames
 *
 * @module ports/hyperview-page-store
 */

/**
 * A loaded source file with its filename and raw UTF-8 content.
 * Used by both page templates and markdown content files.
 *
 * @typedef {Object} HyperviewSourceFile
 * @property {string} filename - Source file name relative to its store root
 * @property {string} source - UTF-8 source contents
 */

/**
 * A loaded template helper with its registered name and implementation.
 *
 * @typedef {Object} HyperviewHelperFile
 * @property {string} name - Helper name exposed to templates
 * @property {Function} helper - Helper function implementation
 */

/**
 * @typedef {Object} HyperviewPageStore
 * @property {function(string): Promise<boolean>} doesPageExist
 *   Checks whether a page exists for the given URL pathname.
 *   MUST resolve with a boolean, never reject.
 * @property {function(string): Promise<Object>} getPageData
 *   Loads page data for the given URL pathname.
 *   MUST resolve with a plain Object; return `{}` when no data exists.
 * @property {function(string, Object=): Promise<HyperviewSourceFile|null>} getPageTemplate
 *   Loads the page template source file for the given URL pathname.
 *   MUST resolve with a HyperviewSourceFile or null; never reject.
 * @property {function(string): Promise<HyperviewSourceFile[]>} getMarkdownContent
 *   Loads all markdown source files associated with the given URL pathname.
 *   MUST resolve with an Array (empty when no markdown exists); never reject.
 */
