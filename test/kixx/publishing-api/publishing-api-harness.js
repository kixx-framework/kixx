// Shared setup for the Publishing API handler tests. Not a test file.
//
// The handlers run against the real ContentAddressableStore over the Node.js
// content store adapter, in a temporary directory.
import { DatabaseSync } from 'node:sqlite';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ContentAddressableStore from '../../../kixx/content-addressable-store/content-addressable-store.js';
import ContentStore from '../../../kixx/adapters/node/content-store/lib/content-store.js';
import Logger from '../../../kixx/logger/logger.js';
import { JSON_API_CONTENT_TYPE } from '../../../kixx/http-router/http-router.js';


// A made-up DEPLOY_KEY_HASH. The handlers never check a key; the middleware
// on the mount does. They only derive the actor from the hash.
export const TEST_HASH = '3f9a1c7e5b2d8f4a6c0e9b1d7f3a5c8e2b6d0f4a9c1e7b3d5f8a2c6e0b4d9f1a';

export const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000001';

const openStores = [];
const directories = [];


/**
 * Builds a request context with a real ContentAddressableStore service.
 * @param {Object} [options]
 * @param {(string|null)} [options.hash] - DEPLOY_KEY_HASH; null leaves it unset
 * @param {string} [options.environment] - Environment name
 * @returns {Promise<{context: Object, service: ContentAddressableStore}>}
 */
export async function makeHarness({ hash = TEST_HASH, environment = 'production' } = {}) {
    const rootDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-publishing-api-'));
    directories.push(rootDirectory);

    const logger = new Logger({ name: 'Test', level: 'NONE' });
    // An in-memory index skips SQLite's per-commit fsync, which would make
    // these tests slow. Blobs still go to disk.
    const database = new DatabaseSync(':memory:');
    const contentStore = new ContentStore({ logger, rootDirectory, format: 4, database, ownsDatabase: true });
    openStores.push(contentStore);

    const service = new ContentAddressableStore();
    service.initialize({ logger, contentStore });

    const env = {};
    if (hash !== null) {
        env.DEPLOY_KEY_HASH = hash;
    }

    const context = {
        env,
        config: { environment },
        logger,
        runtime: { build: { id: 'build-42' } },
        getService(name) {
            if (name !== 'ContentAddressableStore') {
                throw new Error(`Unexpected service ${ name }`);
            }
            return service;
        },
    };

    return { context, service };
}

/**
 * Closes every store and removes every directory the harness made.
 */
export async function removeHarnesses() {
    for (const store of openStores.splice(0)) {
        store.close();
    }
    for (const directory of directories.splice(0)) {
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

/**
 * A request double carrying a JSON:API resource document.
 * @param {Object} [options]
 * @returns {Object} Request double
 */
export function makeJsonRequest(options = {}) {
    const {
        type,
        id,
        attributes = {},
        document,
        pathnameParams = {},
        queryParams = {},
        headers = {},
        contentType = JSON_API_CONTENT_TYPE,
    } = options;

    const body = document ?? { data: { type, id, attributes } };

    return {
        pathnameParams,
        queryParams,
        headers: new Headers(headers),
        getContentMediaType: () => contentType,
        json: async () => structuredClone(body),
    };
}

/**
 * A request double with no body, for GET routes.
 * @param {Object} [options]
 * @returns {Object} Request double
 */
export function makeGetRequest({ pathnameParams = {}, queryParams = {} } = {}) {
    return { pathnameParams, queryParams, headers: new Headers() };
}

export async function catchError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

/**
 * Stores a text object through the service.
 * @returns {Promise<{objectId: string, size: number}>}
 */
export async function uploadText(context, service, text) {
    return await service.putObject(context, text);
}

/**
 * Creates a one-asset Release through the service, as the deploy key.
 * @returns {Promise<Object>} The Release record
 */
export async function createTestRelease(context, service, text = 'body { color: red; }') {
    const object = await uploadText(context, service, text);
    const manifest = { staticAssets: { '/site.css': object } };
    return await service.createRelease(context, manifest, {
        createdBy: { type: 'deploy-key', id: TEST_HASH.slice(0, 12), name: 'Deploy key' },
    });
}

/**
 * Parses a response body and asserts it is JSON:API.
 * @returns {Object} The parsed document
 */
export function readDocument(response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith(JSON_API_CONTENT_TYPE)) {
        throw new Error(`Expected a JSON:API response, got "${ contentType }"`);
    }
    return JSON.parse(response.body);
}
