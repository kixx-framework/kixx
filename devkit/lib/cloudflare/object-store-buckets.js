import { isNonEmptyString, isPlainObject, isUndefined } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';

/**
 * Reads and validates the R2 buckets declared by one environment's
 * `OBJECT_STORE.buckets` block. Binding assembly and resource verification
 * both read buckets through here, so they can never disagree about a bucket.
 * @module object-store-buckets
 */

const JURISDICTIONS = [ 'default', 'eu', 'fedramp' ];

/**
 * @typedef {Object} ObjectStoreBucket
 * @property {string} configPath - Config path of the bucket entry, such as `environments.production.OBJECT_STORE.buckets.files`
 * @property {string} bindingName - Worker binding name
 * @property {string} bucketName - R2 bucket name
 * @property {string|undefined} jurisdiction - `eu` or `fedramp`, or undefined for the default jurisdiction
 */

/**
 * @param {Object} args
 * @param {Object} args.environmentConfig - `environments.<env>` from `cloudflare-config.jsonc`
 * @param {string} args.environment - Environment name, used in config paths
 * @returns {ObjectStoreBucket[]} Declared buckets in configuration order; empty without an `OBJECT_STORE` block
 * @throws {UsageError} When the block or a bucket entry is malformed, naming its config path
 */
export function readObjectStoreBuckets(args) {
    const { environmentConfig, environment } = args ?? {};
    const blockPath = `environments.${ environment }.OBJECT_STORE`;
    const block = environmentConfig.OBJECT_STORE;

    if (isUndefined(block)) {
        return [];
    }

    if (!isPlainObject(block)) {
        throw configError(`${ blockPath } must be an object`);
    }

    const buckets = block.buckets ?? {};

    if (!isPlainObject(buckets)) {
        throw configError(`${ blockPath }.buckets must be an object`);
    }

    return Object.keys(buckets).map((key) => {
        const configPath = `${ blockPath }.buckets.${ key }`;
        const bucket = buckets[key];

        if (!isPlainObject(bucket)) {
            throw configError(`${ configPath } must be an object`);
        }

        const jurisdiction = readOptionalString(bucket.jurisdiction, `${ configPath }.jurisdiction`);

        if (!isUndefined(jurisdiction) && !JURISDICTIONS.includes(jurisdiction)) {
            throw configError(`${ configPath }.jurisdiction must be one of: ${ JURISDICTIONS.join(', ') }`);
        }

        // Only used when creating a bucket, which devkit does not do yet.
        // Validated anyway so a typo fails now rather than in a later phase.
        readOptionalString(bucket.locationHint, `${ configPath }.locationHint`);
        readOptionalString(bucket.storageClass, `${ configPath }.storageClass`);

        return {
            configPath,
            bindingName: requireString(bucket.bindingName, `${ configPath }.bindingName`),
            bucketName: requireString(bucket.bucketName, `${ configPath }.bucketName`),
            // "default" is normalized away so it produces the same binding,
            // and so the same bindings hash, as omitting the key.
            jurisdiction: jurisdiction === 'default' ? undefined : jurisdiction,
        };
    });
}

function requireString(value, configPath) {
    if (!isNonEmptyString(value)) {
        throw configError(`${ configPath } is required and must be a non-empty string`);
    }

    return value;
}

function readOptionalString(value, configPath) {
    if (isUndefined(value)) {
        return undefined;
    }

    if (!isNonEmptyString(value)) {
        throw configError(`${ configPath } must be a non-empty string when present`);
    }

    return value;
}

function configError(detail) {
    return new UsageError(`Invalid cloudflare-config.jsonc: ${ detail }`);
}
