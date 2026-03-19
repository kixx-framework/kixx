/**
 * ConfigStore port — the abstraction for loading application configuration
 * and secrets from any backing source.
 *
 * Implement this interface to support different config sources: in-memory
 * objects (MemoryConfigStore), local config files, remote config services,
 * environment variables, etc. The consumer (Config) calls on() to subscribe,
 * then calls loadConfig() and loadSecrets() to trigger loading.
 *
 * ## Invariants
 * - on() MUST return `this` to allow chaining
 * - loadConfig() MUST emit 'update:config' with the config Object as the
 *   first argument BEFORE the returned Promise resolves
 * - loadSecrets() MUST emit 'update:secrets' with the secrets Object as the
 *   first argument BEFORE the returned Promise resolves
 * - Both load methods SHOULD always resolve rather than reject; surface load
 *   failures by emitting an empty Object so consumers degrade gracefully
 *
 * @module ports/config-store
 */

/**
 * @typedef {Object} ConfigStore
 * @property {function(string, function(Object): void): ConfigStore} on
 *   Registers a listener for 'update:config' or 'update:secrets'.
 *   MUST return `this` for chaining.
 * @property {function(): Promise<Object>} loadConfig
 *   Loads configuration values and MUST emit 'update:config' with the config
 *   Object before the returned Promise resolves.
 * @property {function(): Promise<Object>} loadSecrets
 *   Loads secret values and MUST emit 'update:secrets' with the secrets
 *   Object before the returned Promise resolves.
 */
