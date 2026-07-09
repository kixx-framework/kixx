import path from 'node:path';

import { isPlainObject, assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';
import deepFreeze from '../../../kixx/utils/deep-freeze.js';


export function readConfig(config, environment, baseDirectory) {
    assertNonEmptyString(environment, 'readConfig requires an environment name');
    assertNonEmptyString(baseDirectory, 'readConfig requires a base directory');

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

    const env = config.environments[environment];
    if (!isPlainObject(env)) {
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
        env,
        resolveFilepath(relativeFilepath) {
            assertNonEmptyString(relativeFilepath, 'resolveFilepath requires a relative filepath');

            // The incoming path is always POSIX (forward slashes), but the config
            // may run on a platform that uses a different separator. Split on the
            // POSIX separator and rejoin with path.join() so the returned absolute
            // path is formatted for the current OS.
            return path.join(baseDirectory, ...relativeFilepath.split('/'));
        },
    };

    return deepFreeze(resolvedConfig);
}
