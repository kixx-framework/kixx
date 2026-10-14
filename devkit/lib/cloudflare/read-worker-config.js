import { isNonEmptyString, isPlainObject } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';

/**
 * Reads `environments.<env>` from `cloudflare-config.jsonc`.
 * @param {Object} cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {string} environment - Value of `--environment`
 * @returns {Object} The environment block
 * @throws {UsageError} When `--environment` is missing or names no environment block
 */
export function readEnvironmentConfig(cloudflareConfig, environment) {
    if (!isNonEmptyString(environment)) {
        throw new UsageError('The --environment option is required');
    }

    const environments = cloudflareConfig?.environments;

    // Own property only, so "constructor" or "toString" is not an environment.
    const environmentConfig = isPlainObject(environments) && Object.hasOwn(environments, environment)
        ? environments[environment]
        : undefined;

    if (!isPlainObject(environmentConfig)) {
        throw new UsageError(`Missing required configuration in cloudflare-config.jsonc: environments.${ environment }`);
    }

    return environmentConfig;
}

/**
 * Reads `environments.<env>.WORKER` from `cloudflare-config.jsonc`.
 * @param {Object} cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {string} environment - Value of `--environment`
 * @returns {Object} The WORKER block, which has a non-empty `name`
 * @throws {UsageError} When the environment or its WORKER block is missing
 */
export default function readWorkerConfig(cloudflareConfig, environment) {
    const workerConfig = readEnvironmentConfig(cloudflareConfig, environment).WORKER;
    const configPath = `environments.${ environment }.WORKER`;

    if (!isPlainObject(workerConfig)) {
        throw new UsageError(`Missing required configuration in cloudflare-config.jsonc: ${ configPath }`);
    }
    if (!isNonEmptyString(workerConfig.name)) {
        throw new UsageError(`Missing required configuration in cloudflare-config.jsonc: ${ configPath }.name`);
    }

    return workerConfig;
}
