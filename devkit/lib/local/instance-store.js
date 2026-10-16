/**
 * Local instances on disk: `<target>/instances/<name>/` holding
 * `instance.json`, a `.env`/`.env.secrets` pair, and, once seeded,
 * `credentials.json`.
 * @module local/instance-store
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { isNonEmptyString, isPlainObject } from '../vendor/kixx-assert/mod.js';
import { buildInstanceEnv } from './instance-env.js';
import { formatEnvFile, parseEnvFile } from '../env-file.js';
import { getFreePort as defaultGetFreePort } from '../devserver/app-process.js';
import UsageError from '../usage-error.js';

export const INSTANCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PRIVATE_FILE_MODE = 0o600;

const CREDENTIAL_FIELDS = [ 'baseUrl', 'username', 'password', 'publishingApiToken', 'buildId', 'port' ];


/**
 * @param {string} name - Instance name
 * @throws {UsageError} When the name is not lowercase letters and digits
 *     separated by single hyphens
 */
export function assertValidInstanceName(name) {
    if (typeof name !== 'string' || !INSTANCE_NAME_PATTERN.test(name)) {
        throw new UsageError(
            `Invalid instance name "${ name }". Use lowercase letters and digits, ` +
            'separated by single hyphens (for example "alpha" or "pr-42").',
        );
    }
}

/**
 * @param {Object} args
 * @param {string} args.sourceDirectory - Application directory
 * @param {string} [args.target] - Directory holding `instances/`; default `<source>/.kixx`
 * @returns {string} Absolute instances directory
 */
export function resolveInstancesDirectory(args) {
    const { sourceDirectory, target } = args ?? {};
    return path.resolve(target ?? path.join(sourceDirectory, '.kixx'), 'instances');
}

/**
 * @param {string} instancesDirectory - Absolute instances directory
 * @param {string} name - Validated instance name
 * @returns {{directory: string, dotenv: string, dotenvSecrets: string, metadata: string, credentials: string}}
 */
export function getInstancePaths(instancesDirectory, name) {
    const directory = path.join(instancesDirectory, name);

    return {
        directory,
        dotenv: path.join(directory, '.env'),
        dotenvSecrets: path.join(directory, '.env.secrets'),
        metadata: path.join(directory, 'instance.json'),
        credentials: path.join(directory, 'credentials.json'),
    };
}

/**
 * @param {string} name - Instance name
 * @param {Date} now - Creation time
 * @returns {string} A Build ID unique to this create
 */
export function generateBuildId(name, now) {
    return `local-${ name }-${ now.getTime() }`;
}

/**
 * Creates the instance directory and its `instance.json`, `.env`, and
 * `.env.secrets`. Leaves nothing behind when it fails.
 * @param {Object} args
 * @param {string} args.sourceDirectory - Application directory
 * @param {string} args.instancesDirectory - Absolute instances directory
 * @param {string} args.name - Instance name
 * @param {number} [args.port] - Port; default a free port
 * @param {function(): Date} [args.now]
 * @param {function(): Promise<number>} [args.getFreePort]
 * @returns {Promise<{name: string, directory: string, port: number, buildId: string, envNames: string[]}>}
 * @throws {UsageError} For an invalid name or port, a source that is not a
 *     Kixx app, an existing instance, or an invalid secrets manifest
 */
export async function createInstance(args) {
    const {
        sourceDirectory,
        instancesDirectory,
        name,
        port: requestedPort,
        now = () => new Date(),
        getFreePort = defaultGetFreePort,
    } = args ?? {};

    assertValidInstanceName(name);

    if (requestedPort !== undefined) {
        assertValidPort(requestedPort);
    }

    const serverScript = path.join(sourceDirectory, 'node-server.js');

    if (!await isFile(serverScript)) {
        throw new UsageError(`${ sourceDirectory } is not a Kixx application: ${ serverScript } does not exist.`);
    }

    const paths = getInstancePaths(instancesDirectory, name);

    if (await exists(paths.directory)) {
        throw new UsageError(`Local instance "${ name }" already exists at ${ paths.directory }.`);
    }

    const buildId = generateBuildId(name, now());

    // Built before mkdir, so a bad manifest leaves no directory behind.
    const { plain, secrets } = await buildInstanceEnv({
        sourceDirectory,
        buildId,
        dataDirectory: paths.directory,
    });

    const plainText = formatEnvFile(plain);
    const secretsText = formatEnvFile(secrets);

    const port = requestedPort ?? await getFreePort();

    await fsp.mkdir(paths.directory, { recursive: true });

    try {
        await fsp.writeFile(paths.metadata, `${ JSON.stringify({ port }, null, 4) }\n`);
        await fsp.writeFile(paths.dotenv, plainText);
        await fsp.writeFile(paths.dotenvSecrets, secretsText, { mode: PRIVATE_FILE_MODE });
    } catch (error) {
        await fsp.rm(paths.directory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }

    return {
        name,
        directory: paths.directory,
        port,
        buildId,
        envNames: [ ...Object.keys(plain), ...Object.keys(secrets) ],
    };
}

/**
 * @param {Object} args
 * @param {string} args.instancesDirectory - Absolute instances directory
 * @param {string} args.name - Instance name
 * @returns {Promise<{name: string, paths: Object, port: number, env: Object<string, string>, secrets: Object<string, string>, isSeeded: boolean}>}
 * @throws {UsageError} When the instance is missing or its files are invalid
 */
export async function readInstance(args) {
    const { instancesDirectory, name } = args ?? {};

    assertValidInstanceName(name);

    const paths = getInstancePaths(instancesDirectory, name);

    if (!await exists(paths.directory)) {
        throw new UsageError(
            `No local instance "${ name }" at ${ paths.directory }; run "kixx local create ${ name }" first.`,
        );
    }

    const port = await readPort(paths.metadata);

    if (port === null) {
        throw new UsageError(
            `${ paths.metadata } is missing or invalid; destroy and re-create the instance "${ name }".`,
        );
    }

    const env = await readDotenv(paths.dotenv);
    const secrets = await readDotenv(paths.dotenvSecrets);
    const isSeeded = await exists(paths.credentials);

    return { name, paths, port, env, secrets, isSeeded };
}

/**
 * @param {{credentials: string}} paths - Instance paths
 * @returns {Promise<Object|null>} Parsed credentials, or null when not seeded
 * @throws {UsageError} When the file cannot be read or is not a JSON object
 */
export async function readCredentials(paths) {
    let text;

    try {
        text = await fsp.readFile(paths.credentials, 'utf8');
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw new UsageError(`Unable to read ${ paths.credentials }: ${ cause.message }`, { cause });
    }

    let credentials;

    try {
        credentials = JSON.parse(text);
    } catch (cause) {
        throw new UsageError(`${ paths.credentials } is not valid JSON: ${ cause.message }`, { cause });
    }

    if (!isPlainObject(credentials)) {
        throw new UsageError(`${ paths.credentials } must hold a JSON object`);
    }

    return credentials;
}

/**
 * Writes `credentials.json`, readable only by its owner.
 * @param {{credentials: string}} paths - Instance paths
 * @param {{baseUrl: string, username: string, password: string, publishingApiToken: string, buildId: string, port: number}} credentials
 * @returns {Promise<void>}
 */
export async function writeCredentials(paths, credentials) {
    for (const field of CREDENTIAL_FIELDS) {
        if (credentials?.[field] === undefined || credentials[field] === null || credentials[field] === '') {
            throw new TypeError(`writeCredentials: missing credentials.${ field }`);
        }
    }

    const text = `${ JSON.stringify(credentials, CREDENTIAL_FIELDS, 4) }\n`;

    await fsp.writeFile(paths.credentials, text, { mode: PRIVATE_FILE_MODE });
}

/**
 * @param {Object} args
 * @param {string} args.instancesDirectory - Absolute instances directory
 * @returns {Promise<Array<{name: string, port: number|null, isSeeded: boolean}>>} Sorted by name
 */
export async function listInstances(args) {
    const { instancesDirectory } = args ?? {};

    let entries;

    try {
        entries = await fsp.readdir(instancesDirectory, { withFileTypes: true });
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return [];
        }
        throw cause;
    }

    const names = entries
        .filter((entry) => entry.isDirectory() && INSTANCE_NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name)
        .sort();

    const instances = [];

    for (const name of names) {
        const paths = getInstancePaths(instancesDirectory, name);

        // eslint-disable-next-line no-await-in-loop
        const port = await readPort(paths.metadata);
        // eslint-disable-next-line no-await-in-loop
        const isSeeded = await exists(paths.credentials);

        instances.push({ name, port, isSeeded });
    }

    return instances;
}

/**
 * Removes the instance directory, refusing while its port accepts connections.
 * @param {Object} args
 * @param {string} args.instancesDirectory - Absolute instances directory
 * @param {string} args.name - Instance name
 * @param {function(number): Promise<boolean>} args.canConnect
 * @returns {Promise<{name: string, directory: string}>}
 * @throws {UsageError} When the name is invalid, the instance is missing, or it is running
 */
export async function destroyInstance(args) {
    const { instancesDirectory, name, canConnect } = args ?? {};

    assertValidInstanceName(name);

    const paths = getInstancePaths(instancesDirectory, name);

    if (!await exists(paths.directory)) {
        throw new UsageError(`No local instance "${ name }" at ${ paths.directory }.`);
    }

    // A missing or invalid instance.json does not block removal.
    const port = await readPort(paths.metadata);

    if (port !== null && await canConnect(port)) {
        throw new UsageError(
            `Local instance "${ name }" is running on port ${ port }; stop it before running destroy.`,
        );
    }

    await fsp.rm(paths.directory, { recursive: true, force: true });

    return { name, directory: paths.directory };
}

/**
 * @param {string[]} names - Names to check
 * @param {Object<string, string>} [env] - Defaults to `process.env`
 * @returns {string[]} Names with a non-empty value in env, in the given order
 */
export function findProcessEnvCollisions(names, env = process.env) {
    return names.filter((name) => isNonEmptyString(env[name]));
}


function assertValidPort(port) {
    if (!isValidPort(port)) {
        throw new UsageError(`The port must be an integer from 1 to 65535 (got "${ port }")`);
    }
}

function isValidPort(port) {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Returns null for a missing, unreadable, or invalid instance.json.
async function readPort(filepath) {
    try {
        const metadata = JSON.parse(await fsp.readFile(filepath, 'utf8'));
        return isValidPort(metadata?.port) ? metadata.port : null;
    } catch {
        return null;
    }
}

async function readDotenv(filepath) {
    let text;

    try {
        text = await fsp.readFile(filepath, 'utf8');
    } catch (cause) {
        throw new UsageError(`Unable to read ${ filepath }: ${ cause.message }`, { cause });
    }

    return parseEnvFile(text, filepath, { reservedNames: [] });
}

async function exists(filepath) {
    try {
        await fsp.stat(filepath);
        return true;
    } catch {
        return false;
    }
}

async function isFile(filepath) {
    try {
        return (await fsp.stat(filepath)).isFile();
    } catch {
        return false;
    }
}
