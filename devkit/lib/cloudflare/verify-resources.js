import { isNonEmptyString, isPlainObject, isUndefined } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import { readObjectStoreBuckets } from './object-store-buckets.js';

/**
 * Checks that every D1 database, KV namespace, and R2 bucket an environment
 * configures exists in Cloudflare. Never creates anything: creating resources
 * is a separate, later phase, so a missing resource is reported for the
 * operator to create and record.
 * @module verify-resources
 */

export const NO_ID_CONFIGURED = 'no ID configured';
export const NOT_FOUND = 'not found in Cloudflare';

/**
 * @typedef {Object} ResourceProblem
 * @property {string} configPath - Full config path of the missing value, such as `environments.production.DOCUMENT_STORE.databaseId`
 * @property {string} resource - Resource kind and name, such as `D1 database "abc"`
 * @property {string} cause - `no ID configured` or `not found in Cloudflare`
 */

/**
 * @param {Object} args
 * @param {Object} args.environmentConfig - `environments.<env>` from `cloudflare-config.jsonc`
 * @param {string} args.environment - Environment name, used in config paths
 * @param {import('./cloudflare-api-client.js').default} args.apiClient - Cloudflare API client
 * @returns {Promise<ResourceProblem[]>} Every missing resource, in config order; empty when all exist
 * @throws {UsageError} When a resource block is not an object
 * @throws {import('./cloudflare-api-error.js').default} When a lookup fails for any reason other than a 404
 */
export async function verifyResources(args) {
    const { environmentConfig, environment, apiClient } = args ?? {};
    const prefix = `environments.${ environment }`;

    const checks = [];

    const documentStore = readBlock(environmentConfig, prefix, 'DOCUMENT_STORE');
    if (documentStore) {
        checks.push({
            configPath: `${ prefix }.DOCUMENT_STORE.databaseId`,
            kind: 'D1 database',
            id: documentStore.databaseId,
            lookup: (id) => apiClient.getD1Database(id),
        });
    }

    const keyValueStore = readBlock(environmentConfig, prefix, 'KEY_VALUE_STORE');
    if (keyValueStore) {
        checks.push({
            configPath: `${ prefix }.KEY_VALUE_STORE.namespaceId`,
            kind: 'KV namespace',
            id: keyValueStore.namespaceId,
            lookup: (id) => apiClient.getKVNamespace(id),
        });
    }

    const contentStore = readBlock(environmentConfig, prefix, 'CONTENT_STORE');
    if (contentStore) {
        checks.push({
            configPath: `${ prefix }.CONTENT_STORE.kvNamespaceId`,
            kind: 'KV namespace',
            id: contentStore.kvNamespaceId,
            lookup: (id) => apiClient.getKVNamespace(id),
        });
    }

    // A bucket's name is its ID, and readObjectStoreBuckets() already rejects
    // a missing one as invalid configuration.
    for (const bucket of readObjectStoreBuckets({ environmentConfig, environment })) {
        const where = bucket.jurisdiction ? ` (jurisdiction ${ bucket.jurisdiction })` : '';

        checks.push({
            configPath: `${ bucket.configPath }.bucketName`,
            kind: 'R2 bucket',
            id: bucket.bucketName,
            suffix: where,
            lookup: (id) => apiClient.getR2Bucket(id, bucket.jurisdiction ? { jurisdiction: bucket.jurisdiction } : undefined),
        });
    }

    const problems = [];

    // Sequential so lookups happen in a stable order, and so the first
    // non-404 failure stops the run without further requests.
    for (const check of checks) {
        if (!isNonEmptyString(check.id)) {
            problems.push({ configPath: check.configPath, resource: check.kind, cause: NO_ID_CONFIGURED });
            continue;
        }

        try {
            await check.lookup(check.id);
        } catch (error) {
            if (error?.status !== 404) {
                throw error;
            }

            problems.push({
                configPath: check.configPath,
                resource: `${ check.kind } "${ check.id }"${ check.suffix ?? '' }`,
                cause: NOT_FOUND,
            });
        }
    }

    return problems;
}

function readBlock(environmentConfig, prefix, configKey) {
    const block = environmentConfig[configKey];

    if (isUndefined(block)) {
        return null;
    }

    if (!isPlainObject(block)) {
        throw new UsageError(`Invalid cloudflare-config.jsonc: ${ prefix }.${ configKey } must be an object`);
    }

    return block;
}
