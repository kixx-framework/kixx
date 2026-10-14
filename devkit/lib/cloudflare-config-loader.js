import path from 'node:path';
import { isPlainObject } from './vendor/kixx-assert/mod.js';
import defaultFileSystem from './file-system.js';
import { parseJsonc } from './parse-jsonc.js';
import UsageError from './usage-error.js';


export const CLOUDFLARE_CONFIG_FILE_NAME = 'cloudflare-config.jsonc';


/**
 * Reads and parses the project's `cloudflare-config.jsonc`. The file is data,
 * never executed, so the CLI needs no permission to run project code.
 * @param {string} projectDirectory - Directory containing cloudflare-config.jsonc
 * @param {Object} [args]
 * @param {import('./file-system.js').FileSystem} [args.fileSystem] - File system seam for tests
 * @returns {Promise<Object>} The parsed configuration object
 * @throws {UsageError} When the file is absent or unreadable, is not valid JSONC, is not an object, or lacks an `environments` object
 */
export async function loadCloudflareConfig(projectDirectory, args) {
    const { fileSystem = defaultFileSystem } = args ?? {};
    const filepath = path.resolve(projectDirectory, CLOUDFLARE_CONFIG_FILE_NAME);

    let source;

    try {
        source = await fileSystem.readFile(filepath);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            throw new UsageError(`Missing required Cloudflare configuration file: ${ filepath }`, { cause });
        }

        throw new UsageError(`Unable to read ${ filepath }: ${ cause.message }`, { cause });
    }

    let config;

    try {
        config = parseJsonc(source);
    } catch (cause) {
        throw new UsageError(`Unable to parse JSONC in ${ filepath }: ${ cause.message }`, { cause });
    }

    if (!isPlainObject(config)) {
        throw new UsageError(`Expected a JSON object at the top level of ${ filepath }`);
    }

    if (!isPlainObject(config.environments)) {
        throw new UsageError(`Expected an "environments" object in ${ filepath }`);
    }

    return config;
}
