import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import deepFreeze from '../utils/deep-freeze.js';
import deepMerge from '../utils/deep-merge.js';


/**
 * Selects an environment from a source config and returns an immutable runtime config.
 *
 * The selected environment is merged over `options.defaults`: plain objects
 * merge key by key at every depth, while an array or any other value in the
 * environment replaces the default whole. The defaults and the selected
 * environment are copied, so neither is mutated or frozen.
 *
 * @param {Object} config - Source config with an environments map
 * @param {string} environment - Environment name to select
 * @param {Object} [options] - Runtime-specific config reader options
 * @param {Function} [options.resolveFilepath] - Resolves config-relative file paths for runtimes with a local filesystem
 * @param {Object} [options.defaults] - Default environment values the selected environment is merged over
 * @returns {Object} Frozen config with the selected environment name and values exposed as `environment` and `env`
 * @throws {OperationalError} When the source config does not define the selected environment
 * @throws {AssertionError} When options.defaults is given and is not a plain object
 */
export function readConfig(config, environment, options) {
    const { resolveFilepath, defaults } = options ?? {};

    assertNonEmptyString(environment, 'readConfig requires an environment name');

    if (!isUndefined(resolveFilepath)) {
        assertFunction(resolveFilepath, 'readConfig: options.resolveFilepath');
    }

    // Defaults come from generated code, so a wrong type is a bug, not a
    // mistake in the project's config.
    if (!isUndefined(defaults)) {
        assert(isPlainObject(defaults), 'readConfig: options.defaults must be a plain object');
    }

    if (!isPlainObject(config)) {
        throw new OperationalError(
            'Config must be a plain object',
            {},
            readConfig,
        );
    }

    if (!isPlainObject(config.environments)) {
        throw new OperationalError(
            'Config must contain an environments object',
            {},
            readConfig,
        );
    }

    const hasSelectedEnvironment = Object.hasOwn(config.environments, environment);
    const selectedEnvironment = config.environments[environment];
    if (!hasSelectedEnvironment || !isPlainObject(selectedEnvironment)) {
        throw new OperationalError(
            `Config does not define the "${ environment }" environment`,
            {},
            readConfig,
        );
    }

    const configFields = { ...config };
    delete configFields.environments;
    delete configFields.resolveFilepath;

    const resolvedConfig = {
        ...configFields,
        environment,
        env: deepMerge({}, defaults ?? {}, selectedEnvironment),
    };

    if (resolveFilepath) {
        resolvedConfig.resolveFilepath = resolveFilepath;
    }

    return deepFreeze(resolvedConfig);
}
