import {
    AssertionError,
    isNumberNotNaN,
    isNonEmptyString,
    assertNumberNotNaN,
} from '../assertions/mod.js';


/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @typedef {import('./app-runtime.js').default} AppRuntime
 */


/**
 * Shared context properties and environment-accessor methods.
 *
 * The environment accessors are runtime-agnostic: `env` may be a plain object,
 * a Cloudflare Workers binding bag, or any other key/value store that supports
 * bracket-notation reads.
 */
export default class BaseContext {

    /**
     * @param {Object} options
     * @param {Object} options.env - Environment variables, secrets, and platform bindings.
     * @param {Logger} options.logger - Root application logger.
     * @param {Object} [options.config] - Resolved request configuration.
     * @param {AppRuntime} options.runtime - Runtime metadata shared by contexts.
     */
    constructor(options) {
        const {
            config,
            env,
            logger,
            runtime,
        } = options ?? {};

        const properties = {
            /**
             * Accessor for environment variables, secrets, and bindings.
             * @name env
             * @type {Object}
             */
            env: { value: env, enumerable: true },
            /**
             * Root application logger.
             * @name logger
             * @type {Logger}
             */
            logger: { value: logger, enumerable: true },
            /**
             * Runtime metadata indicating whether the application is serving HTTP
             * requests or executing a CLI command.
             * @name runtime
             * @type {AppRuntime}
             */
            runtime: { value: runtime, enumerable: true },
        };

        if (Object.hasOwn(options ?? {}, 'config')) {
            properties.config = {
                value: config,
                enumerable: true,
            };
        }

        Object.defineProperties(this, properties);
    }

    /**
     * Returns the raw string value of an environment variable.
     * @param {string} key - The environment variable name.
     * @param {Object} [options]
     * @param {boolean} [options.required=false] - Throw AssertionError if the variable is missing or empty.
     * @returns {string|undefined} The value, or undefined if missing and `required` is false.
     * @throws {AssertionError} When `required` is true and the variable is missing or an empty string.
     */
    getEnvString(key, options) {
        const { required = false } = options ?? {};
        const value = this.env[key];
        if (isNonEmptyString(value)) {
            return value;
        }
        if (required) {
            throw new AssertionError(`Environment variable "${ key }" is required`);
        }
        return undefined;
    }

    /**
     * Returns the value of an environment variable parsed as a base-10 integer.
     *
     * Accepts a value already stored as a number, or a string that can be parsed
     * as a base-10 integer. Float numbers and unparseable strings both throw.
     *
     * @param {string} key - The environment variable name.
     * @param {Object} [options]
     * @param {boolean} [options.required=false] - Throw AssertionError if the variable is missing or empty.
     * @returns {number|undefined} The parsed integer, or undefined if missing and `required` is false.
     * @throws {AssertionError} When `required` is true and the variable is missing or empty.
     * @throws {AssertionError} When the variable exists but is a float or an unparseable string.
     */
    getEnvInteger(key, options) {
        const { required = false } = options ?? {};
        const raw = this.env[key];
        if (isNumberNotNaN(raw)) {
            if (Number.isInteger(raw)) {
                return raw;
            }
            throw new AssertionError(`Environment variable ${ key } is expected to be an integer`);
        }
        if (!isNonEmptyString(raw)) {
            if (required) {
                throw new AssertionError(`Environment variable "${ key }" is required`);
            }
            return undefined;
        }
        const value = Number.parseInt(raw, 10);
        assertNumberNotNaN(value, `Environment variable ${ key }`);
        return value;
    }

    /**
     * Returns the value of an environment variable parsed as a floating-point number.
     *
     * Accepts a value already stored as a number, or a string that can be parsed
     * as a float. Unparseable strings throw.
     *
     * @param {string} key - The environment variable name.
     * @param {Object} [options]
     * @param {boolean} [options.required=false] - Throw AssertionError if the variable is missing or empty.
     * @returns {number|undefined} The parsed float, or undefined if missing and `required` is false.
     * @throws {AssertionError} When `required` is true and the variable is missing or empty.
     * @throws {AssertionError} When the variable exists but cannot be parsed as a float.
     */
    getEnvFloat(key, options) {
        const { required = false } = options ?? {};
        const raw = this.env[key];
        if (isNumberNotNaN(raw)) {
            return raw;
        }
        if (!isNonEmptyString(raw)) {
            if (required) {
                throw new AssertionError(`Environment variable "${ key }" is required`);
            }
            return undefined;
        }
        const value = Number.parseFloat(raw);
        assertNumberNotNaN(value, `Environment variable ${ key }`);
        return value;
    }

    /**
     * Returns the value of an environment variable cast to a boolean.
     *
     * Truthy inputs: `true`, `1`, `"true"`, `"1"`.
     * Falsy inputs: `false`, `0`, `"false"`, `"0"`.
     * Missing or unrecognized values return `false`.
     *
     * @param {string} key - The environment variable name.
     * @returns {boolean}
     */
    getEnvBoolean(key) {
        const raw = this.env[key];

        switch (raw) {
            case true:
            case 1:
            case 'true':
            case '1':
                return true;
            // The explicit falsy cases document the recognized boolean vocabulary;
            // they share the result with `default`, which also catches missing and
            // unrecognized values.
            case false:
            case 0:
            case 'false':
            case '0':
                return false;
            default:
                return false;
        }
    }
}
