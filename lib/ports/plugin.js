/**
 * Plugin port — the contract for Kixx application plugins that register
 * and initialize services with the ApplicationContext.
 *
 * Plugins are the primary extension point for adding capabilities to a Kixx
 * application: HTTP handlers, template engines, data stores, background
 * workers, etc. The bootstrap process calls register() synchronously on all
 * plugins first, then calls initialize() on each one in sequence.
 *
 * ## Invariants
 * - register() MUST be synchronous; use it only to register components with
 *   the ApplicationContext (do not perform I/O or async work here)
 * - initialize() MUST return a Promise; use it for async setup such as
 *   connecting to databases, loading initial data, or warming caches
 * - The bootstrap process calls register() on ALL plugins before calling
 *   initialize() on any of them, so all registrations are visible during
 *   any plugin's initialize()
 * - initialize() calls are sequential, not concurrent; a plugin may safely
 *   depend on a previously initialized plugin's side effects
 *
 * @module ports/plugin
 */

/**
 * @typedef {Object} Plugin
 * @property {function(ApplicationContext): void} register
 *   Registers plugin components with the application context synchronously.
 *   Called before any plugin's initialize(). Must not perform I/O.
 * @property {function(ApplicationContext): Promise<void>} initialize
 *   Performs async plugin initialization (I/O, warm-up, etc.).
 *   Called after all plugins have been registered. Must return a Promise.
 */
