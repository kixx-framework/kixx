/**
 * The one check for the development environment, so every rule that relaxes
 * in development (the open deploy key, the publish gates) reads the same flag.
 * @module
 */

/**
 * The environment name local development runs under.
 * @type {string}
 */
export const DEVELOPMENT_ENVIRONMENT = 'development';

/**
 * Says whether a config names the development environment.
 * @param {Object} [config] - The app config; reads `environment`
 * @returns {boolean} True only when `config.environment` is `'development'`
 */
export function isDevelopmentEnvironment(config) {
    return config?.environment === DEVELOPMENT_ENVIRONMENT;
}
