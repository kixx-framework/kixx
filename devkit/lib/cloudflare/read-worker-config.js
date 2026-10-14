import { isNonEmptyString, isPlainObject } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';

/**
 * Reads `environments.<env>.WORKER` from `cloudflare-config.jsonc`.
 * @param {Object} cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {string} environment - Value of `--environment`
 * @returns {Object} The WORKER block, which has a non-empty `name`
 * @throws {UsageError} When the environment or its WORKER block is missing
 */
export default function readWorkerConfig(cloudflareConfig, environment) {
    if (!isNonEmptyString(environment)) {
        throw new UsageError('The --environment option is required');
    }

    const configPath = `environments.${ environment }.WORKER`;
    const workerConfig = cloudflareConfig?.environments?.[environment]?.WORKER;

    if (!isPlainObject(workerConfig)) {
        throw new UsageError(`Missing required configuration in cloudflare-config.jsonc: ${ configPath }`);
    }
    if (!isNonEmptyString(workerConfig.name)) {
        throw new UsageError(`Missing required configuration in cloudflare-config.jsonc: ${ configPath }.name`);
    }

    return workerConfig;
}
