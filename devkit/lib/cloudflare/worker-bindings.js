import { isNonEmptyString, isPlainObject, isUndefined } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';
import { readObjectStoreBuckets } from './object-store-buckets.js';

/**
 * Assembles one environment's config blocks, `.env.<env>` values, and
 * inherited secret names into a validated, name-sorted array of Cloudflare
 * binding definitions.
 *
 * The result never contains `BUILD_ID`. It is the bindings hash input, and
 * `BUILD_ID` is generated only after the change decision; adding it here
 * would make every build look changed.
 * @module worker-bindings
 */

/**
 * Binding names the deploy tool owns. `ENVIRONMENT` comes from
 * `--environment`; `BUILD_ID` is generated per upload.
 * @type {string[]}
 */
export const RESERVED_NAMES = Object.freeze([ 'BUILD_ID', 'ENVIRONMENT' ]);

const BINDING_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {Object} args
 * @param {Object} args.environmentConfig - `environments.<env>` from `cloudflare-config.jsonc`
 * @param {string} args.environment - Environment name, bound as `ENVIRONMENT`
 * @param {Object<string, string>} [args.envars] - Values from `.env.<env>`, bound as `plain_text`
 * @param {string[]} [args.inheritedSecretNames] - `inheritedNames` from `compareDeclaredSecrets()`
 * @param {string} [args.secretVersionId] - Exact version the secrets are inherited from; required with any inherited name
 * @returns {Array<Object>} Binding definitions accepted by `CloudflareWorkerVersion#addBinding()`, sorted by name
 * @throws {UsageError} When a config block is malformed or a binding name
 *     collides across two sources, naming the config path or source
 */
export function buildWorkerBindings(args) {
    const {
        environmentConfig,
        environment,
        envars = {},
        inheritedSecretNames = [],
        secretVersionId,
    } = args ?? {};

    const prefix = `environments.${ environment }`;

    const entries = [
        ...documentStoreBindings(environmentConfig, prefix),
        ...keyValueStoreBindings(environmentConfig, prefix),
        ...contentStoreBindings(environmentConfig, prefix),
        ...jobQueueBindings(environmentConfig, prefix),
        ...objectStoreBindings(environmentConfig, environment),
        ...nameOnlyBindings(environmentConfig, prefix, 'SEND_EMAIL', 'send_email'),
        ...nameOnlyBindings(environmentConfig, prefix, 'IMAGES', 'images'),
        environmentBinding(environment),
        ...envarsBindings(environment, envars),
        ...secretBindings(inheritedSecretNames, secretVersionId),
    ];

    checkCollisions(entries);

    return entries
        .map((entry) => entry.binding)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
}

function documentStoreBindings(environmentConfig, prefix) {
    const block = readBlock(environmentConfig, prefix, 'DOCUMENT_STORE');

    if (!block) {
        return [];
    }

    return [ {
        source: `${ prefix }.DOCUMENT_STORE`,
        binding: {
            type: 'd1',
            name: requireBindingName(block.bindingName, `${ prefix }.DOCUMENT_STORE.bindingName`),
            id: requireString(block.databaseId, `${ prefix }.DOCUMENT_STORE.databaseId`),
        },
    } ];
}

function keyValueStoreBindings(environmentConfig, prefix) {
    const block = readBlock(environmentConfig, prefix, 'KEY_VALUE_STORE');

    if (!block) {
        return [];
    }

    return [ {
        source: `${ prefix }.KEY_VALUE_STORE`,
        binding: {
            type: 'kv_namespace',
            name: requireBindingName(block.bindingName, `${ prefix }.KEY_VALUE_STORE.bindingName`),
            namespace_id: requireString(block.namespaceId, `${ prefix }.KEY_VALUE_STORE.namespaceId`),
        },
    } ];
}

function contentStoreBindings(environmentConfig, prefix) {
    const block = readBlock(environmentConfig, prefix, 'CONTENT_STORE');

    if (!block) {
        return [];
    }

    const path = `${ prefix }.CONTENT_STORE`;

    return [
        {
            source: path,
            binding: {
                type: 'kv_namespace',
                name: requireBindingName(block.kvBindingName, `${ path }.kvBindingName`),
                namespace_id: requireString(block.kvNamespaceId, `${ path }.kvNamespaceId`),
            },
        },
        {
            source: path,
            binding: {
                type: 'durable_object_namespace',
                name: requireBindingName(block.durableObjectBindingName, `${ path }.durableObjectBindingName`),
                class_name: requireString(block.durableObjectClassName, `${ path }.durableObjectClassName`),
            },
        },
    ];
}

// Only the Durable Object namespace is a binding. Every other JOB_QUEUE key
// is runtime configuration read by the application.
function jobQueueBindings(environmentConfig, prefix) {
    const block = readBlock(environmentConfig, prefix, 'JOB_QUEUE');

    if (!block) {
        return [];
    }

    const path = `${ prefix }.JOB_QUEUE`;

    return [ {
        source: path,
        binding: {
            type: 'durable_object_namespace',
            name: requireBindingName(block.durableObjectBindingName, `${ path }.durableObjectBindingName`),
            class_name: requireString(block.durableObjectClassName, `${ path }.durableObjectClassName`),
        },
    } ];
}

function objectStoreBindings(environmentConfig, environment) {
    return readObjectStoreBuckets({ environmentConfig, environment }).map((bucket) => {
        const binding = {
            type: 'r2_bucket',
            name: requireBindingName(bucket.bindingName, `${ bucket.configPath }.bindingName`),
            bucket_name: bucket.bucketName,
        };

        // A bucket outside the default jurisdiction is invisible to a binding
        // that does not name it.
        if (bucket.jurisdiction) {
            binding.jurisdiction = bucket.jurisdiction;
        }

        return { source: bucket.configPath, binding };
    });
}

// A binding with only a name, such as SEND_EMAIL or IMAGES. Every other key
// in the block is application configuration.
function nameOnlyBindings(environmentConfig, prefix, configKey, type) {
    const block = readBlock(environmentConfig, prefix, configKey);

    if (!block) {
        return [];
    }

    return [ {
        source: `${ prefix }.${ configKey }`,
        binding: { type, name: requireBindingName(block.bindingName, `${ prefix }.${ configKey }.bindingName`) },
    } ];
}

// The Worker selects its config section with ENVIRONMENT, so the value comes
// from --environment, never from a dotenv file that may have been copied
// from another environment.
function environmentBinding(environment) {
    return {
        source: '--environment',
        binding: { type: 'plain_text', name: 'ENVIRONMENT', text: environment },
    };
}

function envarsBindings(environment, envars) {
    const source = `.env.${ environment }`;

    // readEnvFile() drops ENVIRONMENT and rejects BUILD_ID with a line number;
    // this guards callers that build envars some other way.
    for (const name of RESERVED_NAMES) {
        if (Object.hasOwn(envars, name)) {
            throw new UsageError(`${ source } may not declare "${ name }"; the deploy tool owns that name`);
        }
    }

    return Object.keys(envars).map((name) => ({
        source,
        binding: { type: 'plain_text', name, text: envars[name] },
    }));
}

function secretBindings(names, versionId) {
    if (names.length > 0 && !isNonEmptyString(versionId)) {
        throw new Error('buildWorkerBindings: secretVersionId is required to inherit secrets');
    }

    return names.map((name) => ({
        source: 'example.env.secrets',
        binding: { type: 'inherit', name, version_id: versionId },
    }));
}

function checkCollisions(entries) {
    const byName = new Map();

    for (const entry of entries) {
        const { name } = entry.binding;
        const existing = byName.get(name);

        if (existing) {
            throw new UsageError(
                `Duplicate Worker binding name "${ name }" from both ${ existing.source } and ${ entry.source }`,
            );
        }

        byName.set(name, entry);
    }
}

function readBlock(environmentConfig, prefix, configKey) {
    const block = environmentConfig[configKey];

    if (isUndefined(block)) {
        return null;
    }

    if (!isPlainObject(block)) {
        throw configError(`${ prefix }.${ configKey } must be an object`);
    }

    return block;
}

function requireBindingName(value, configPath) {
    const name = requireString(value, configPath);

    if (!BINDING_NAME_PATTERN.test(name)) {
        throw configError(`${ configPath } must be a letter or underscore followed by letters, digits, or underscores`);
    }

    if (RESERVED_NAMES.includes(name)) {
        throw configError(`${ configPath } "${ name }" is reserved by the deploy tool`);
    }

    return name;
}

function requireString(value, configPath) {
    if (!isNonEmptyString(value)) {
        throw configError(`${ configPath } is required and must be a non-empty string`);
    }

    return value;
}

function configError(detail) {
    return new UsageError(`Invalid cloudflare-config.jsonc: ${ detail }`);
}
