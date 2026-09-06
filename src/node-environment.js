import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { assertNonEmptyString, isNonEmptyString } from './kixx/assertions/mod.js';
import { OperationalError } from './kixx/errors/mod.js';
import { mergeEnvironmentSources } from './kixx/config/merge-environment-sources.js';
import { parseSecretsManifest } from './kixx/config/secrets-manifest.js';


// Reads UTF-8 text, throwing the raw filesystem error. Injectable wherever it
// is used below so a test can supply file contents without a real filesystem.
function defaultReadFile(filepath) {
    return fs.readFileSync(filepath, 'utf8');
}


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
 * process.env into one environment object, then optionally checks the result
 * against the secrets manifest.
 *
 * Each file is independently optional, which is what lets the dotenv-file and
 * process-environment deployment styles be used together rather than as an
 * either/or. Overlap between the three sources is rejected by
 * mergeEnvironmentSources so a key placed in the wrong file fails loudly at
 * startup instead of resolving silently.
 *
 * When `secretsManifestFile` is given, every secret name the manifest requires
 * must resolve to a non-empty string, or startup fails here — before any store
 * is opened. This is what keeps the manifest honest with what the application
 * actually reads. Names the manifest marks `# @optional` are not checked.
 *
 * @param {Object} options
 * @param {string} options.dotenvFile - Absolute path to the plain dotenv file.
 * @param {string} [options.secretsManifestFile] - Absolute path to `example.env.secrets`. Omitted, no check runs.
 * @param {(filepath: string) => string} [options.readFile] - UTF-8 file reader, defaulting to `fs.readFileSync`.
 * @returns {Object} Merged environment variables, keyed by name.
 * @throws {OperationalError} When a dotenv file exists but cannot be read or parsed, a key is defined by more
 *     than one source, the manifest is missing or unreadable, or a required secret is absent.
 */
export function readEnvironment(options) {
    const { dotenvFile, secretsManifestFile, readFile = defaultReadFile } = options ?? {};

    assertNonEmptyString(dotenvFile, 'readEnvironment: dotenvFile');

    // Secrets live beside the plain file rather than in it, so a deployment can
    // bind the two halves differently. The path is derived instead of separately
    // configurable so --dotenv keeps selecting the pair with one flag.
    const dotenvSecretsFile = `${ dotenvFile }.secrets`;

    const env = mergeEnvironmentSources([
        { name: dotenvFile, values: readOptionalDotEnvFile(dotenvFile, readFile) },
        { name: dotenvSecretsFile, values: readOptionalDotEnvFile(dotenvSecretsFile, readFile) },
        { name: 'process.env', values: process.env },
    ]);

    if (isNonEmptyString(secretsManifestFile)) {
        assertRequiredSecrets(env, secretsManifestFile, readFile);
    }

    return env;
}

// Unlike the dotenv files, the manifest is committed and must exist: a
// deployment which cannot find it has no way to know what it is missing, so an
// absent file is a misconfiguration rather than a shape to tolerate.
function assertRequiredSecrets(env, secretsManifestFile, readFile) {
    let source;

    try {
        source = readFile(secretsManifestFile);
    } catch (cause) {
        throw new OperationalError(
            `Unable to read the secrets manifest from ${ secretsManifestFile }`,
            { cause },
            readEnvironment,
        );
    }

    let manifest;

    try {
        manifest = parseSecretsManifest(source);
    } catch (cause) {
        throw new OperationalError(
            `Unable to parse the secrets manifest from ${ secretsManifestFile }: ${ cause.message }`,
            { cause },
            readEnvironment,
        );
    }

    // Report every missing name at once, the way mergeEnvironmentSources
    // reports every duplicate: missing secrets usually arrive as a group, and
    // one per boot cycle would be a slow way to find that out.
    const missing = manifest.required.filter((name) => !isNonEmptyString(env[name]));

    if (missing.length > 0) {
        throw new OperationalError(
            `Missing required environment secrets: ${ missing.join(', ') }. ` +
            `They are declared in ${ secretsManifestFile }.`,
            {},
            readEnvironment,
        );
    }
}

/**
 * Returns undefined when the file does not exist. A missing dotenv file is a
 * normal deployment shape, but a file which exists and cannot be read or
 * parsed is a misconfiguration and must not be silently skipped.
 *
 * @param {string} filepath - Absolute path to a dotenv file.
 * @param {(filepath: string) => string} [readFile] - UTF-8 file reader, defaulting to `fs.readFileSync`.
 * @returns {Object|undefined} Parsed key/value pairs, or undefined when the file does not exist.
 * @throws {OperationalError} When the file exists but cannot be read or parsed.
 */
export function readOptionalDotEnvFile(filepath, readFile = defaultReadFile) {
    let source;
    try {
        source = readFile(filepath);
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
