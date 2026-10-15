import path from 'node:path';
import { isPlainObject } from '../vendor/kixx-assert/mod.js';
import defaultFileSystem from '../file-system.js';
import UsageError from '../usage-error.js';

/**
 * Writes the module `cloudflare-server.js` imports its config from. Workers
 * cannot read the JSONC file at runtime, so the selected environment is
 * emitted as a plain ES module that the bundler packages with the app.
 * @module generated-config
 */

export const GENERATED_CONFIG_FILE_NAME = 'cloudflare-config.generated.js';

const HEADER = '// Generated from cloudflare-config.jsonc by `kixx cloudflare create-worker-version`. Do not edit or commit.';

/**
 * Renders the generated module text. Only the selected environment is kept,
 * so edits to another environment cannot change this one's `modulesHash` or
 * leak into its bundle. Output is deterministic: source key order, LF line
 * endings, and one trailing newline.
 * @param {Object} args - Options
 * @param {string} args.environment - Selected environment name
 * @param {Object} args.cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @returns {string} ES module source
 * @throws {UsageError} When `environments.<environment>` is not an object
 */
export function renderGeneratedConfig(args) {
    const { environment, cloudflareConfig } = args ?? {};

    const environmentConfig = cloudflareConfig?.environments?.[environment];

    if (!Object.hasOwn(cloudflareConfig?.environments ?? {}, environment) || !isPlainObject(environmentConfig)) {
        throw new UsageError(`Missing configuration in cloudflare-config.jsonc: environments.${ environment }`);
    }

    // Reassigning keeps `environments` at its source position in the output.
    const selected = { ...cloudflareConfig, environments: { [environment]: environmentConfig } };

    return `${ HEADER }\nexport default ${ JSON.stringify(selected, null, 4) };\n`;
}

/**
 * Writes `<project>/cloudflare-config.generated.js` for the selected
 * environment. Kept separate from bundling so the caller decides when it runs.
 * @param {Object} args - Options
 * @param {string} args.projectDirectory - Absolute project root
 * @param {string} args.environment - Selected environment name
 * @param {Object} args.cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {import('../file-system.js').FileSystem} [args.fileSystem] - Filesystem adapter
 * @returns {Promise<string>} Absolute path of the written file
 * @throws {UsageError} When `environments.<environment>` is not an object
 */
export async function writeGeneratedConfig(args) {
    const {
        projectDirectory,
        environment,
        cloudflareConfig,
        fileSystem = defaultFileSystem,
    } = args ?? {};

    const text = renderGeneratedConfig({ environment, cloudflareConfig });
    const filepath = path.join(projectDirectory, GENERATED_CONFIG_FILE_NAME);

    await fileSystem.writeFile(filepath, text);

    return filepath;
}
