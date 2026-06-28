import {
    assertNonEmptyString,
    isFunction,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';


const DEFAULT_CONFIG_STORE_BINDING_NAME = 'CONFIG_STORE';
const DEFAULT_CONFIG_STORE_KEY = 'config';


export async function readConfig(env, environment) {
    assertNonEmptyString(environment, 'readConfig requires an environment name');
    const bindingName = env.CONFIG_STORE_BINDING_NAME || DEFAULT_CONFIG_STORE_BINDING_NAME;
    const configKey = env.CONFIG_STORE_KEY || DEFAULT_CONFIG_STORE_KEY;

    const config = await parseConfigBinding(env, bindingName, configKey);

    if (!isPlainObject(config.environments)) {
        throw new OperationalError(
            `Config binding "${ bindingName }" must contain an environments object`,
            null,
            readConfig,
        );
    }

    const selectedEnvironment = config.environments[environment];
    if (!isPlainObject(selectedEnvironment)) {
        throw new OperationalError(
            `Config binding "${ bindingName }" does not define the "${ environment }" environment`,
            null,
            readConfig,
        );
    }

    // Expose the selected environment as `env` so callers read a single resolved
    // bundle regardless of which environment was requested.
    config.env = selectedEnvironment;
    delete config.environments;

    return config;
}

async function parseConfigBinding(env, bindingName, configKey) {
    const configStore = env[bindingName];
    if (!configStore || !isFunction(configStore.get)) {
        throw new OperationalError(
            `Config binding "${ bindingName }" must be a KV namespace`,
            null,
            readConfig,
        );
    }

    let config;
    try {
        config = await configStore.get(configKey, { type: 'json' });
    } catch (cause) {
        throw new OperationalError(
            `Unable to read config key "${ configKey }" from binding "${ bindingName }"`,
            { cause },
            readConfig,
        );
    }

    if (!isPlainObject(config)) {
        throw new OperationalError(
            `Config key "${ configKey }" in binding "${ bindingName }" must contain a JSON object`,
            null,
            readConfig,
        );
    }

    return config;
}
