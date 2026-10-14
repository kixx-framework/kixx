import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
    isObjectNotNull,
    isPlainObject,
    isUndefined,
} from './vendor/kixx-assert/mod.js';
import UsageError from './usage-error.js';

/**
 * Discovery and merging of the two configuration layers used by the CLI.
 *
 * Settings live in a `.kixx` directory at two scopes: the user home directory
 * and the project directory. The project layer is merged over the home layer,
 * so shared credentials are written once in the home directory while each
 * project only records what differs.
 * @module ConfigLoader
 */

const CONFIG_DIRECTORY_NAME = '.kixx';
const CONFIG_FILE_NAME = 'config.json';
const SECRETS_FILE_NAME = 'secrets.json';


/**
 * @typedef {Object} Configuration
 * @property {string} projectDirectory - Discovered project root, or the starting directory when no project was found.
 * @property {Object} config - Frozen, merged general configuration settings.
 * @property {Object} secrets - Frozen, merged secrets.
 * @property {string[]} configFilepaths - Config files searched, home layer first.
 * @property {string[]} secretsFilepaths - Secrets files searched, home layer first.
 */

/**
 * Loads and merges the home and project configuration layers.
 *
 * A missing `.kixx` directory or a missing file yields an empty layer; only a
 * file which exists but cannot be used is treated as an error.
 * @param {Object} [args] - Loader options.
 * @param {string} [args.startDirectory=process.cwd()] - Directory to begin the upward search for a project.
 * @param {string} [args.homeDirectory=os.homedir()] - Directory holding the home layer, and the upper bound of the search.
 * @returns {Promise<Configuration>} Merged configuration with the searched filepaths.
 * @throws {UsageError} When a file exists but is unreadable, is not valid JSON, or is not a JSON object.
 */
export async function loadConfiguration(args) {
    const {
        startDirectory = process.cwd(),
        homeDirectory = os.homedir(),
    } = args ?? {};

    const projectDirectory = await findProjectDirectory(startDirectory, homeDirectory);

    // Both layers are searched even when the project layer is absent so the
    // filepath lists stay useful for reporting where a value should be added.
    const configFilepaths = buildFilepaths(CONFIG_FILE_NAME, homeDirectory, projectDirectory);
    const secretsFilepaths = buildFilepaths(SECRETS_FILE_NAME, homeDirectory, projectDirectory);

    const config = await mergeFileLayers(configFilepaths);
    const secrets = await mergeFileLayers(secretsFilepaths);

    return {
        projectDirectory: projectDirectory ?? path.resolve(startDirectory),
        config: deepFreeze(config),
        secrets: deepFreeze(secrets),
        configFilepaths,
        secretsFilepaths,
    };
}

/**
 * Reports which of the given dotted key paths are absent from a loaded layer.
 *
 * A path is absent when any segment along it is missing, when it resolves
 * through a non-object, or when the resolved value is null or undefined. Null
 * counts as absent so a project layer can cancel a value inherited from home.
 * @param {Object} source - Merged config or secrets object.
 * @param {string[]} keyPaths - Dotted key paths, such as `cloudflare.apiToken`.
 * @returns {string[]} The subset of keyPaths which are absent, in the given order.
 */
export function findMissingKeys(source, keyPaths) {
    return (keyPaths ?? []).filter((keyPath) => {
        const value = getValueAtPath(source, keyPath);
        return isUndefined(value) || value === null;
    });
}

// Walks up from the starting directory looking for the directory which owns a
// `.kixx` directory. The search stops before reaching the home directory
// because `~/.kixx` is already loaded as the home layer; treating it as a
// project layer as well would merge that layer over itself.
async function findProjectDirectory(startDirectory, homeDirectory) {
    let currentDirectory = path.resolve(startDirectory);
    const { root } = path.parse(currentDirectory);

    while (currentDirectory !== homeDirectory) {
        const candidate = path.join(currentDirectory, CONFIG_DIRECTORY_NAME);

        if (await isDirectory(candidate)) {
            return currentDirectory;
        }

        if (currentDirectory === root) {
            return null;
        }

        currentDirectory = path.dirname(currentDirectory);
    }

    return null;
}

function buildFilepaths(filename, homeDirectory, projectDirectory) {
    const filepaths = [ path.join(homeDirectory, CONFIG_DIRECTORY_NAME, filename) ];

    if (projectDirectory) {
        filepaths.push(path.join(projectDirectory, CONFIG_DIRECTORY_NAME, filename));
    }

    return filepaths;
}

async function mergeFileLayers(filepaths) {
    let merged = {};

    // Ordered home first, so each later layer overrides the ones before it.
    for (const filepath of filepaths) {
        const layer = await readJsonObject(filepath);

        if (layer) {
            merged = mergeDeep(merged, layer);
        }
    }

    return merged;
}

async function readJsonObject(filepath) {
    let text;

    try {
        text = await fsp.readFile(filepath, 'utf8');
    } catch (cause) {
        // An absent file is the normal state for any layer the user has not
        // created. Anything else means the file is there but unusable, which
        // is never intentional and must not be silently treated as empty.
        if (cause.code === 'ENOENT') {
            return null;
        }

        throw new UsageError(`Unable to read ${ filepath }: ${ cause.message }`, { cause });
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch (cause) {
        // JSON.parse reports the line and column of the offending token, which
        // is the most useful part of the message for a hand-edited file.
        throw new UsageError(`Unable to parse JSON in ${ filepath }: ${ cause.message }`, { cause });
    }

    if (!isPlainObject(data)) {
        throw new UsageError(`Expected a JSON object at the top level of ${ filepath }`);
    }

    return data;
}

// Merges plain objects recursively so a project layer can add a key to a
// nested block without restating the rest of it. Arrays and scalars are
// replaced outright: a project overriding a list means "use these instead",
// and there would be no way to express removal under concatenation.
function mergeDeep(base, override) {
    const result = Object.assign({}, base);

    for (const [ key, value ] of Object.entries(override)) {
        if (isPlainObject(value) && isPlainObject(result[key])) {
            result[key] = mergeDeep(result[key], value);
        } else {
            result[key] = value;
        }
    }

    return result;
}

// Object.freeze() is shallow, so nested settings would otherwise stay mutable.
// The isFrozen() guard matters because merged results share subtree references
// with the layer objects, so the same object can be reached more than once.
function deepFreeze(target) {
    for (const value of Object.values(target)) {
        if (isObjectNotNull(value) && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }

    return Object.freeze(target);
}

function getValueAtPath(source, keyPath) {
    let current = source;

    for (const key of keyPath.split('.')) {
        if (!isPlainObject(current)) {
            return undefined;
        }

        current = current[key];
    }

    return current;
}

async function isDirectory(filepath) {
    try {
        const stats = await fsp.stat(filepath);
        return stats.isDirectory();
    } catch {
        return false;
    }
}
