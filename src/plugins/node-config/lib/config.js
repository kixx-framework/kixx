import fs from 'node:fs';
import path from 'node:path';

import { isPlainObject, assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';


export function readConfig(absoluteConfigPath, environment) {
    assertNonEmptyString(absoluteConfigPath, 'readConfig requires a config file path');
    assertNonEmptyString(environment, 'readConfig requires an environment name');

    const baseDirectory = path.dirname(absoluteConfigPath);

    const config = parseConfigFile(absoluteConfigPath);

    if (!isPlainObject(config.environments)) {
        throw new OperationalError(
            `Config file at ${ absoluteConfigPath } must contain an environments object`,
            null,
            readConfig,
        );
    }

    const env = config.environments[environment];
    if (!isPlainObject(env)) {
        throw new OperationalError(
            `Config file at ${ absoluteConfigPath } does not define the "${ environment }" environment`,
            null,
            readConfig,
        );
    }

    // Expose the selected environment as `env` so callers read a single resolved
    // bundle regardless of which environment was requested.
    config.env = env;
    config.baseDirectory = baseDirectory;
    delete config.environments;

    return config;
}

function parseConfigFile(absoluteConfigPath) {
    let source;
    try {
        source = fs.readFileSync(absoluteConfigPath, 'utf8');
    } catch (cause) {
        throw new OperationalError(
            `Unable to read config file at ${ absoluteConfigPath }`,
            { cause },
            readConfig,
        );
    }

    let config;
    try {
        config = JSON.parse(source);
    } catch (cause) {
        throw new OperationalError(
            `Unable to parse config file JSON at ${ absoluteConfigPath }`,
            { cause },
            readConfig,
        );
    }

    if (!isPlainObject(config)) {
        throw new OperationalError(
            `Config file at ${ absoluteConfigPath } must contain a JSON object`,
            null,
            readConfig,
        );
    }

    return config;
}
