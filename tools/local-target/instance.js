import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assertNonEmptyString, isNonEmptyString } from '../../src/kixx/assertions/mod.js';
import { OperationalError } from '../../src/kixx/errors/mod.js';


const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repository root, two directories above tools/local-target/.
 * @type {string}
 */
export const REPO_ROOT = path.join(THIS_DIRECTORY, '..', '..');

/**
 * Root directory holding every local target instance.
 * @type {string}
 */
export const INSTANCES_ROOT = path.join(REPO_ROOT, 'data', 'local-targets');

/**
 * Instance names are used as a path segment and a Build ID component, so they
 * are restricted to lowercase alphanumerics separated by single hyphens.
 * @type {RegExp}
 */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PLAIN_ENV_KEYS = [ 'ENVIRONMENT', 'TRUST_PROXY', 'PORT', 'BUILD_ID', 'DATA_DIRECTORY' ];
const SECRET_ENV_KEYS = [ 'DOCUMENT_STORE_CURSOR_SIGNING_SECRET', 'CSRF_TOKEN_SIGNING_SECRET', 'ADMIN_BOOTSTRAP_TOKEN' ];

/**
 * Validates an instance name.
 * @param {string} name - Candidate instance name.
 * @returns {void}
 * @throws {OperationalError} When name is missing or does not match NAME_PATTERN.
 */
export function assertValidName(name) {
    if (!isNonEmptyString(name) || !NAME_PATTERN.test(name)) {
        throw new OperationalError(
            `Instance name "${ name }" must match ${ NAME_PATTERN } (lowercase letters, digits, and single hyphens)`,
        );
    }
}

/**
 * @param {string} name - Instance name.
 * @returns {string} Absolute path to the instance directory.
 */
export function getInstanceDirectory(name) {
    assertValidName(name);
    return path.join(INSTANCES_ROOT, name);
}

/**
 * @param {string} name - Instance name.
 * @returns {string} Absolute path to the instance's plain dotenv file.
 */
export function getDotenvPath(name) {
    return path.join(getInstanceDirectory(name), '.env');
}

/**
 * @param {string} name - Instance name.
 * @returns {string} Absolute path to the instance's dotenv secrets file.
 */
export function getDotenvSecretsPath(name) {
    return `${ getDotenvPath(name) }.secrets`;
}

/**
 * @param {string} name - Instance name.
 * @returns {string} Absolute path to the instance's credentials file.
 */
export function getCredentialsPath(name) {
    return path.join(getInstanceDirectory(name), 'credentials.json');
}

/**
 * @param {string} name - Instance name.
 * @returns {boolean} True when the instance directory exists.
 */
export function instanceExists(name) {
    return fs.existsSync(getInstanceDirectory(name));
}

/**
 * Builds the Build ID assigned to a fresh instance: unique per `create` call
 * so re-seeding a destroyed-and-recreated instance never reuses a prior
 * instance's Build ID.
 * @param {string} name - Instance name.
 * @returns {string} A valid, lowercase Build ID.
 */
export function generateBuildId(name) {
    return `local-${ name }-${ Date.now() }`;
}

/**
 * @param {number} [byteLength=32] - Number of random bytes to encode.
 * @returns {string} A hex-encoded random secret.
 */
export function generateSecret(byteLength = 32) {
    return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Formats the plain (committed-shape) dotenv file content for an instance.
 * @param {Object} options
 * @param {number} options.port - The instance's server port.
 * @param {string} options.buildId - The instance's Build ID.
 * @param {string} options.dataDirectory - Absolute path stores resolve against.
 * @returns {string} Dotenv file content, newline-terminated.
 */
export function formatPlainDotenv(options) {
    const { port, buildId, dataDirectory } = options ?? {};

    assertNonEmptyString(buildId, 'formatPlainDotenv: buildId');
    assertNonEmptyString(dataDirectory, 'formatPlainDotenv: dataDirectory');

    return [
        'ENVIRONMENT=local',
        'TRUST_PROXY=false',
        `PORT=${ port }`,
        `BUILD_ID=${ buildId }`,
        `DATA_DIRECTORY=${ dataDirectory }`,
        '',
    ].join('\n');
}

/**
 * Formats the dotenv secrets file content for an instance, generating a fresh
 * random value for every secret.
 * @returns {{ content: string, adminBootstrapToken: string }} The file content and the generated bootstrap token, which the seed step needs directly.
 */
export function formatSecretsDotenv() {
    const documentStoreCursorSigningSecret = generateSecret();
    const csrfTokenSigningSecret = generateSecret();
    const adminBootstrapToken = generateSecret();

    const content = [
        `DOCUMENT_STORE_CURSOR_SIGNING_SECRET=${ documentStoreCursorSigningSecret }`,
        `CSRF_TOKEN_SIGNING_SECRET=${ csrfTokenSigningSecret }`,
        `ADMIN_BOOTSTRAP_TOKEN=${ adminBootstrapToken }`,
        '',
    ].join('\n');

    return { content, adminBootstrapToken };
}

/**
 * Lists which of the dotenv keys this tool writes are also present in
 * process.env, so `create` can warn the operator before startup rejects the
 * duplicate under the no-key-defined-twice rule.
 * @returns {string[]} Colliding key names, in the order they would be written.
 */
export function findProcessEnvCollisions() {
    return [ ...PLAIN_ENV_KEYS, ...SECRET_ENV_KEYS ].filter((key) => isNonEmptyString(process.env[key]));
}

/**
 * Creates a fresh instance directory and writes its dotenv pair.
 * @param {string} name - Instance name.
 * @param {Object} [options]
 * @param {number} [options.port] - Port to assign; a free port is discovered when omitted.
 * @returns {Promise<{ port: number, buildId: string, dataDirectory: string }>} The values written to the dotenv pair.
 * @throws {OperationalError} When the instance directory already exists.
 */
export async function createInstance(name, options) {
    assertValidName(name);

    const instanceDirectory = getInstanceDirectory(name);
    if (instanceExists(name)) {
        throw new OperationalError(`Local target instance "${ name }" already exists at ${ instanceDirectory }`);
    }

    const { port: requestedPort } = options ?? {};
    const port = requestedPort ?? await findFreePort();
    const buildId = generateBuildId(name);
    const dataDirectory = instanceDirectory;

    await fsp.mkdir(instanceDirectory, { recursive: true });

    await fsp.writeFile(getDotenvPath(name), formatPlainDotenv({ port, buildId, dataDirectory }));

    const { content: secretsContent } = formatSecretsDotenv();
    await fsp.writeFile(getDotenvSecretsPath(name), secretsContent);

    return { port, buildId, dataDirectory };
}

/**
 * Removes an instance directory recursively.
 * @param {string} name - Instance name.
 * @returns {Promise<void>}
 * @throws {OperationalError} When the instance does not exist, or its port is currently accepting connections.
 */
export async function destroyInstance(name) {
    assertValidName(name);

    const instanceDirectory = getInstanceDirectory(name);
    if (!instanceExists(name)) {
        throw new OperationalError(`Local target instance "${ name }" does not exist at ${ instanceDirectory }`);
    }

    const port = readInstancePort(name);
    if (isNonEmptyString(port) && await isPortAccepting(Number.parseInt(port, 10))) {
        throw new OperationalError(
            `Local target instance "${ name }" is still serving on port ${ port }; stop it before running destroy`,
        );
    }

    await fsp.rm(instanceDirectory, { recursive: true, force: true });
}

/**
 * Reads the credentials file written by `seed`.
 * @param {string} name - Instance name.
 * @returns {Object|null} Parsed credentials, or null when the file does not exist.
 * @throws {OperationalError} When the file exists but cannot be read or parsed.
 */
export function readCredentials(name) {
    const credentialsPath = getCredentialsPath(name);

    let source;
    try {
        source = fs.readFileSync(credentialsPath, 'utf8');
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            return null;
        }
        throw new OperationalError(`Unable to read credentials file at ${ credentialsPath }`, { cause });
    }

    try {
        return JSON.parse(source);
    } catch (cause) {
        throw new OperationalError(`Unable to parse credentials file at ${ credentialsPath }`, { cause });
    }
}

/**
 * Builds the plain credentials object `seed` writes to disk.
 * @param {Object} options
 * @param {number} options.port - The instance's server port.
 * @param {string} options.buildId - The Release build pointer the instance serves.
 * @param {string} options.username - Root admin email address.
 * @param {string} options.password - Root admin password.
 * @param {string} options.publishingApiToken - One-time plaintext Publishing API token.
 * @returns {Object} Plain, JSON-serializable credentials object.
 */
export function formatCredentials(options) {
    const {
        port,
        buildId,
        username,
        password,
        publishingApiToken,
    } = options ?? {};

    assertNonEmptyString(username, 'formatCredentials: username');
    assertNonEmptyString(password, 'formatCredentials: password');
    assertNonEmptyString(publishingApiToken, 'formatCredentials: publishingApiToken');
    assertNonEmptyString(buildId, 'formatCredentials: buildId');

    return {
        baseUrl: `http://localhost:${ port }/`,
        username,
        password,
        publishingApiToken,
        buildId,
        port,
    };
}

/**
 * Writes the credentials file for an instance. Plain text on disk inside a
 * `.gitignore`d directory: treat it like any other local secret.
 * @param {string} name - Instance name.
 * @param {Object} credentials - Plain credentials object, see formatCredentials().
 * @returns {Promise<void>}
 */
export async function writeCredentials(name, credentials) {
    const credentialsPath = getCredentialsPath(name);
    await fsp.writeFile(credentialsPath, JSON.stringify(credentials, null, 2) + '\n');
}

/**
 * Discovers an available TCP port by binding to port 0 and reading back the
 * OS-assigned port.
 * @returns {Promise<number>} A currently free port.
 */
export function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function readInstancePort(name) {
    const dotenvPath = getDotenvPath(name);
    let source;
    try {
        source = fs.readFileSync(dotenvPath, 'utf8');
    } catch {
        return null;
    }
    const match = source.match(/^PORT=(\d+)$/m);
    return match ? match[1] : null;
}

function isPortAccepting(port) {
    return new Promise((resolve) => {
        if (!Number.isInteger(port)) {
            resolve(false);
            return;
        }

        const socket = net.connect({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}
