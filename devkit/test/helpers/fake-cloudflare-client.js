import CloudflareApiError from '../../lib/cloudflare/cloudflare-api-error.js';

/**
 * Methods `create-worker-version` may call. Any other method on the fake
 * throws, so a call to a resource-creating or secret endpoint cannot pass
 * silently; `forbiddenCalls()` also reports it after the fact.
 */
export const ALLOWED_METHODS = Object.freeze([
    'getWorker',
    'listWorkerVersions',
    'getWorkerVersion',
    'getD1Database',
    'getKVNamespace',
    'getR2Bucket',
    'createWorkerVersion',
]);

/**
 * Creates a fake Cloudflare API client recording every call.
 * @param {Object} [options]
 * @param {?Object} [options.worker] - `getWorker` result; null makes it 404
 * @param {Array<Object>} [options.versions] - Worker versions, newest first, each `{ id, bindings }`
 * @param {string[]} [options.d1] - Existing D1 database ids
 * @param {string[]} [options.kv] - Existing KV namespace ids
 * @param {string[]} [options.r2] - Existing buckets as `name` or `name|jurisdiction`
 * @param {Object<string, Error>} [options.failures] - Method name to error thrown instead
 * @param {Object} [options.created] - `createWorkerVersion` result
 * @returns {Object} Client with `calls` and `forbiddenCalls()`
 */
export default function createFakeCloudflareClient(options) {
    const {
        worker = { deployed_on: null, references: { durable_objects: [] } },
        versions = [],
        d1 = [],
        kv = [],
        r2 = [],
        failures = {},
        created = { id: 'new-version-id' },
    } = options ?? {};

    const calls = [];

    const methods = {
        async getWorker(name) {
            if (!worker) {
                throw notFound(`workers/${ name }`);
            }
            return worker;
        },
        async listWorkerVersions(_name, { page, per_page }) {
            return versions.slice((page - 1) * per_page, page * per_page).map(({ id }) => ({ id }));
        },
        async getWorkerVersion(_name, versionId) {
            const version = versions.find((entry) => entry.id === versionId);
            if (!version) {
                throw notFound(`versions/${ versionId }`);
            }
            return version;
        },
        async getD1Database(id) {
            return lookup(d1, id, 'd1');
        },
        async getKVNamespace(id) {
            return lookup(kv, id, 'kv');
        },
        async getR2Bucket(name, lookupOptions) {
            const key = lookupOptions?.jurisdiction ? `${ name }|${ lookupOptions.jurisdiction }` : name;
            return lookup(r2, key, 'r2');
        },
        async createWorkerVersion() {
            return created;
        },
    };

    const client = {
        calls,
        forbiddenCalls() {
            return calls.filter((call) => !ALLOWED_METHODS.includes(call.method));
        },
        callsTo(method) {
            return calls.filter((call) => call.method === method);
        },
    };

    return new Proxy(client, {
        get(target, property) {
            if (Object.hasOwn(target, property) || typeof property === 'symbol' || property === 'then') {
                return target[property];
            }

            return async (...args) => {
                calls.push({ method: property, args });

                if (failures[property]) {
                    throw failures[property];
                }
                if (!Object.hasOwn(methods, property)) {
                    throw new Error(`Unexpected Cloudflare API call: ${ property }`);
                }

                return methods[property](...args);
            };
        },
    });
}

export function notFound(pathname) {
    return new CloudflareApiError('Not found', { status: 404, method: 'GET', url: `https://api.cloudflare.com/${ pathname }` });
}

function lookup(existing, id, kind) {
    if (!existing.includes(id)) {
        throw notFound(`${ kind }/${ id }`);
    }
    return { id };
}
