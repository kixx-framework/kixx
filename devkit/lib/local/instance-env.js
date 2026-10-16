/**
 * Builds the dotenv values for a local instance from the source app's
 * `example.env` and `example.env.secrets`.
 * @module local/instance-env
 */

import path from 'node:path';
import defaultFileSystem from '../file-system.js';
import { generateSecretToken } from '../crypto.js';
import { parseEnvFile } from '../env-file.js';
import { readSecretsManifest } from '../cloudflare/secrets-manifest.js';

const EXAMPLE_ENV_FILE_NAME = 'example.env';

// Seeding redeems it, so it is generated even though apps mark it optional.
const BOOTSTRAP_TOKEN_NAME = 'ADMIN_BOOTSTRAP_TOKEN';

// Kept in instance.json and passed as --port, so an exported PORT never
// collides with a dotenv value.
const DROPPED_PLAIN_NAMES = [ 'PORT', 'BUILD_ID' ];


/**
 * @param {Object} args
 * @param {string} args.sourceDirectory - Application directory
 * @param {string} args.buildId - Build ID for the instance
 * @param {string} args.dataDirectory - Absolute instance directory
 * @param {import('../file-system.js').FileSystem} [args.fileSystem]
 * @returns {Promise<{plain: Object<string, string>, secrets: Object<string, string>}>}
 * @throws {UsageError} When `example.env.secrets` is missing or invalid, or
 *     `example.env` is invalid
 */
export async function buildInstanceEnv(args) {
    const {
        sourceDirectory,
        buildId,
        dataDirectory,
        fileSystem = defaultFileSystem,
    } = args ?? {};

    const manifest = await readSecretsManifest({ projectDirectory: sourceDirectory, fileSystem });

    const plain = await readExampleEnv(sourceDirectory, fileSystem);

    for (const name of DROPPED_PLAIN_NAMES) {
        delete plain[name];
    }

    plain.ENVIRONMENT = 'local';
    plain.BUILD_ID = buildId;
    plain.DATA_DIRECTORY = dataDirectory;

    const secrets = {};

    for (const name of manifest.required) {
        secrets[name] = generateSecretToken();
    }

    secrets[BOOTSTRAP_TOKEN_NAME] = generateSecretToken();

    return { plain, secrets };
}


async function readExampleEnv(sourceDirectory, fileSystem) {
    const filepath = path.join(sourceDirectory, EXAMPLE_ENV_FILE_NAME);

    if (!await fileSystem.isFile(filepath)) {
        return {};
    }

    const text = await fileSystem.readFile(filepath);

    // A plain object, so assigned keys keep the template's order.
    return { ...parseEnvFile(text, filepath, { reservedNames: [] }) };
}
