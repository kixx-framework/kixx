import { isPlainObject, isUndefined, AssertionError } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import readWorkerConfig, { readEnvironmentConfig } from './read-worker-config.js';
import CloudflareWorkerVersion from './cloudflare-worker-version.js';

/**
 * Validates the parts of `cloudflare-config.jsonc` that `create-worker-version`
 * reads before anything else: the environment block, `WORKER.name`, and
 * `WORKER_VERSION`. Environment and `WORKER` checks are shared with the other
 * Cloudflare commands through `read-worker-config.js`.
 * @module worker-version-config
 */

/**
 * `WORKER_VERSION` keys copied into the version payload. `annotations` is
 * excluded because the command writes `workers/tag` and
 * `workers/triggered_by` itself; an authored block would be hashed into
 * `configHash` and then discarded.
 * @type {string[]}
 */
export const WORKER_VERSION_KEYS = Object.freeze([
    'compatibility_date',
    'compatibility_flags',
    'limits',
    'placement',
    'cache_options',
]);

/**
 * @typedef {Object} WorkerVersionConfig
 * @property {Object} environmentConfig - `environments.<env>`
 * @property {Object} workerConfig - `environments.<env>.WORKER`, with a non-empty `name`
 * @property {Object} workerVersionConfig - `environments.<env>.WORKER_VERSION`, or `{}` when absent
 */

/**
 * @param {Object} cloudflareConfig - Parsed `cloudflare-config.jsonc`
 * @param {string} environment - Value of `--environment`
 * @returns {WorkerVersionConfig}
 * @throws {UsageError} When the environment, `WORKER.name`, or a
 *     `WORKER_VERSION` key or value is missing or invalid, naming its config path
 */
export function readWorkerVersionConfig(cloudflareConfig, environment) {
    const environmentConfig = readEnvironmentConfig(cloudflareConfig, environment);
    const workerConfig = readWorkerConfig(cloudflareConfig, environment);

    const path = `environments.${ environment }.WORKER_VERSION`;
    const workerVersionConfig = environmentConfig.WORKER_VERSION;

    if (isUndefined(workerVersionConfig)) {
        return { environmentConfig, workerConfig, workerVersionConfig: {} };
    }

    if (!isPlainObject(workerVersionConfig)) {
        throw configError(`${ path } must be an object`);
    }

    for (const key of Object.keys(workerVersionConfig)) {
        if (key === 'annotations') {
            throw configError(
                `${ path }.annotations is not supported; ` +
                'create-worker-version writes the version annotations itself',
            );
        }
        if (!WORKER_VERSION_KEYS.includes(key)) {
            throw configError(`${ path }.${ key } is not supported. Supported keys are: ${ WORKER_VERSION_KEYS.join(', ') }`);
        }
    }

    // The payload builder owns the value rules; run them now so a bad value
    // is reported as configuration, not as an internal assertion at upload.
    try {
        new CloudflareWorkerVersion(workerVersionConfig);
    } catch (error) {
        if (error instanceof AssertionError) {
            const detail = error.message
                .replace(/^CloudflareWorkerVersion\(\) /, '')
                .replace(/ \(Expected .*\)$/, '');

            throw configError(`${ path }: ${ detail }`);
        }
        throw error;
    }

    return { environmentConfig, workerConfig, workerVersionConfig };
}

function configError(detail) {
    return new UsageError(`Invalid cloudflare-config.jsonc: ${ detail }`);
}
