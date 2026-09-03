import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { assertNonEmptyString, isNonEmptyString } from './kixx/assertions/mod.js';
import { OperationalError } from './kixx/errors/mod.js';
import { mergeEnvironmentSources } from './kixx/config/merge-environment-sources.js';


/**
 * Resolves the dotenv file path for an environment: the explicit --dotenv
 * value when provided, otherwise `.env.<environment>` inside baseDirectory.
 *
 * @param {Object} options
 * @param {string} options.baseDirectory - Directory holding the default `.env.<environment>` files.
 * @param {string} options.environment - Selected environment name.
 * @param {string} [options.dotenv] - Explicit --dotenv CLI value, resolved against the current working directory.
 * @returns {string} Absolute path to the plain dotenv file.
 */
export function resolveDotenvFilepath(options) {
    const { baseDirectory, environment, dotenv } = options ?? {};

    assertNonEmptyString(baseDirectory, 'resolveDotenvFilepath: baseDirectory');
    assertNonEmptyString(environment, 'resolveDotenvFilepath: environment');

    return isNonEmptyString(dotenv)
        ? path.resolve(dotenv)
        : path.join(baseDirectory, `.env.${ environment }`);
}

/**
 * Merges the plain dotenv file, its derived `.secrets` sibling, and
 * process.env into one environment object.
 *
 * Each file is independently optional, which is what lets the dotenv-file and
 * process-environment deployment styles be used together rather than as an
 * either/or. Overlap between the three sources is rejected by
 * mergeEnvironmentSources so a key placed in the wrong file fails loudly at
 * startup instead of resolving silently.
 *
 * @param {Object} options
 * @param {string} options.dotenvFile - Absolute path to the plain dotenv file.
 * @returns {Object} Merged environment variables, keyed by name.
 * @throws {OperationalError} When a dotenv file exists but cannot be read or parsed, or a key is defined by more than one source.
 */
export function readEnvironment(options) {
    const { dotenvFile } = options ?? {};

    assertNonEmptyString(dotenvFile, 'readEnvironment: dotenvFile');

    // Secrets live beside the plain file rather than in it, so a deployment can
    // bind the two halves differently. The path is derived instead of separately
    // configurable so --dotenv keeps selecting the pair with one flag.
    const dotenvSecretsFile = `${ dotenvFile }.secrets`;

    return mergeEnvironmentSources([
        { name: dotenvFile, values: readOptionalDotEnvFile(dotenvFile) },
        { name: dotenvSecretsFile, values: readOptionalDotEnvFile(dotenvSecretsFile) },
        { name: 'process.env', values: process.env },
    ]);
}

/**
 * Returns undefined when the file does not exist. A missing dotenv file is a
 * normal deployment shape, but a file which exists and cannot be read or
 * parsed is a misconfiguration and must not be silently skipped.
 *
 * @param {string} filepath - Absolute path to a dotenv file.
 * @returns {Object|undefined} Parsed key/value pairs, or undefined when the file does not exist.
 * @throws {OperationalError} When the file exists but cannot be read or parsed.
 */
export function readOptionalDotEnvFile(filepath) {
    let source;
    try {
        source = fs.readFileSync(filepath, 'utf8');
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return undefined;
        }
        throw new OperationalError(`Unable to read dotenv file from ${ filepath }`, { cause });
    }

    try {
        return util.parseEnv(source);
    } catch (cause) {
        throw new OperationalError(`Unable to parse dotenv file from ${ filepath }`, { cause });
    }
}

/**
 * Builds a resolveFilepath function for config-relative paths. Config file
 * paths are POSIX-style so deployment config stays portable; the returned
 * function rejoins the segments with node:path so the result is an OS-native
 * absolute path.
 *
 * Resolves against dataDirectory when it is a non-empty string, otherwise
 * against baseDirectory. This is what lets a local target instance point
 * every store at its own directory (via the DATA_DIRECTORY environment
 * variable) while every other environment keeps resolving against `src/`
 * exactly as before.
 *
 * @param {Object} options
 * @param {string} options.baseDirectory - Default directory config-relative paths resolve against.
 * @param {string} [options.dataDirectory] - Overrides baseDirectory when set, from the DATA_DIRECTORY environment variable.
 * @returns {Function} `resolveFilepath(relativeFilepath: string): string`
 */
export function createResolveFilepath(options) {
    const { baseDirectory, dataDirectory } = options ?? {};

    assertNonEmptyString(baseDirectory, 'createResolveFilepath: baseDirectory');

    const root = isNonEmptyString(dataDirectory) ? dataDirectory : baseDirectory;

    return function resolveFilepath(relativeFilepath) {
        assertNonEmptyString(relativeFilepath, 'resolveFilepath requires a relative filepath');
        return path.join(root, ...relativeFilepath.split('/'));
    };
}
