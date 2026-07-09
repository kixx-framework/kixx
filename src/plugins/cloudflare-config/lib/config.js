import {
    assertNonEmptyString,
    isPlainObject,
} from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';
import deepFreeze from '../../../kixx/utils/deep-freeze.js';


export function readConfig(config, environment) {
    assertNonEmptyString(environment, 'readConfig requires an environment name');

    if (!isPlainObject(config)) {
        throw new OperationalError(
            'Config must be a plain object',
            null,
            readConfig,
        );
    }

    if (!isPlainObject(config.environments)) {
        throw new OperationalError(
            'Config must contain an environments object',
            null,
            readConfig,
        );
    }

    const selectedEnvironment = config.environments[environment];
    if (!isPlainObject(selectedEnvironment)) {
        throw new OperationalError(
            `Config does not define the "${ environment }" environment`,
            null,
            readConfig,
        );
    }

    const configFields = { ...config };
    delete configFields.environments;

    const resolvedConfig = {
        ...configFields,
        env: selectedEnvironment,
    };

    return deepFreeze(resolvedConfig);
}
