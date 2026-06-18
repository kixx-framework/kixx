import fs from 'node:fs';
import path from 'node:path';

import { isNonEmptyString, isPlainObject, assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { OperationalError } from '../../../kixx/errors/mod.js';

/**
 * The known config bundles under `env` that carry a filesystem location, mapped
 * to the member name that holds it. `DOCUMENT_STORE` and `KEY_VALUE_STORE` point
 * at a sqlite file (`path`); `PAGE_DATA_STORE` and `TEMPLATE_FILE_STORE` point at
 * a directory (`directory`). Each location is resolved relative to the config
 * file's own directory.
 * @type {Array<[string, string]>}
 */
const STORE_LOCATION_MEMBERS = [
    [ 'DOCUMENT_STORE', 'path' ],
    [ 'KEY_VALUE_STORE', 'path' ],
    [ 'PAGE_DATA_STORE', 'directory' ],
    [ 'TEMPLATE_FILE_STORE', 'directory' ],
];

/**
 * Reads and parses the JSON config file at the given location.
 *
 * The filesystem location on each known store config bundle under `env`
 * (DOCUMENT_STORE, KEY_VALUE_STORE, PAGE_DATA_STORE, TEMPLATE_FILE_STORE) is
 * resolved to an absolute path relative to the config file's directory, so the
 * returned config is ready to hand to filesystem-backed stores.
 *
 * @param {string} configFilePath - Path to the config file. A relative path is
 *   resolved against the current working directory.
 * @returns {Object} The parsed config object with `path`/`directory` members
 *   rewritten to absolute paths.
 * @throws {OperationalError} When the file cannot be read, is not valid JSON, or
 *   does not parse to a plain object.
 */
export function readConfig(configFilePath) {
    assertNonEmptyString(configFilePath, 'readConfig requires a config file path');

    const absoluteConfigPath = path.resolve(configFilePath);
    const baseDirectory = path.dirname(absoluteConfigPath);

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

    resolveStoreLocations(config, baseDirectory);

    return config;
}

function resolveStoreLocations(config, baseDirectory) {
    const { env } = config;
    if (!isPlainObject(env)) {
        return;
    }

    for (const [ bundleName, memberKey ] of STORE_LOCATION_MEMBERS) {
        const bundle = env[bundleName];
        if (isPlainObject(bundle) && isNonEmptyString(bundle[memberKey])) {
            // Store plugins validate required fields; the config reader only
            // normalizes filesystem locations relative to the config file.
            bundle[memberKey] = path.resolve(baseDirectory, bundle[memberKey]);
        }
    }
}
