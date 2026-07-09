import {
    assertFunction,
    assertNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../assertions/mod.js';
import { OperationalError } from '../errors/mod.js';
import deepFreeze from '../utils/deep-freeze.js';


/**
 * Selects an environment from a source config and returns an immutable runtime config.
 * @param {Object} config - Source config with an environments map
 * @param {string} environment - Environment name to select
 * @param {Object} [options] - Runtime-specific config reader options
 * @param {Function} [options.resolveFilepath] - Resolves config-relative file paths for runtimes with a local filesystem
 * @returns {Object} Frozen config with the selected environment exposed as `env`
 * @throws {OperationalError} When the source config does not define the selected environment
 */
export function readConfig(config, environment, options) {
    const { resolveFilepath } = options ?? {};

    assertNonEmptyString(environment, 'readConfig requires an environment name');

    if (!isUndefined(resolveFilepath)) {
        assertFunction(resolveFilepath, 'readConfig: options.resolveFilepath');
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

    const selectedEnvironment = config.environments[environment];
    if (!isPlainObject(selectedEnvironment)) {
        throw new OperationalError(
            `Config does not define the "${ environment }" environment`,
            {},
            readConfig,
        );
    }

    const configFields = { ...config };
    delete configFields.environments;

    const resolvedConfig = {
        ...configFields,
        env: selectedEnvironment,
    };

    if (resolveFilepath) {
        resolvedConfig.resolveFilepath = resolveFilepath;
    }

    return deepFreeze(resolvedConfig);
}
