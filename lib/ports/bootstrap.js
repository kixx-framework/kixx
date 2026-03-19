/**
 * Bootstrap port — the abstraction for platform-specific application wiring.
 *
 * Implement this interface to support different deployment targets: Node.js,
 * Cloudflare Workers, AWS Lambda, Deno, etc. The consumer (ApplicationAssembler)
 * calls these methods to obtain platform-specific collaborators without knowing
 * which concrete platform is in use.
 *
 * ## Invariants
 * - createConfigStore() MUST return a ConfigStore-conformant object
 * - createHttpRoutesStore() MUST return an HttpRoutesStore-conformant object
 * - getPrintWriter() MUST return a function that accepts a string
 *
 * @module ports/bootstrap
 */

/**
 * @typedef {import('./config-store.js').ConfigStore} ConfigStore
 */

/**
 * @typedef {import('./http-routes-store.js').HttpRoutesStore} HttpRoutesStore
 */

/**
 * @typedef {Object} Bootstrap
 * @property {function(): ConfigStore} createConfigStore
 *   Creates and returns a platform-specific ConfigStore adapter.
 * @property {function(Array<Object>): HttpRoutesStore} createHttpRoutesStore
 *   Creates and returns a platform-specific HttpRoutesStore adapter for the given
 *   virtual host route configurations.
 * @property {function(): function(string): void} getPrintWriter
 *   Returns the platform-specific output function used by logger implementations.
 */
