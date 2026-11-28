// Boots the fixture project for the tests beside this file. It is not a
// test file: the runner collects only `*.test.js`.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFalsy } from 'kixx-assert';

import { parseJsonc } from '../../kixx/config/parse-jsonc.js';
import { startNodeServer } from '../../kixx/adapters/node/server/lib/node-server.js';
import { createWorker } from '../../kixx/adapters/cloudflare/server/lib/cloudflare-worker.js';
import ContentAddressableIndexStoreCore from '../../kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js';
import { createFakeDurableObjectNamespace } from '../fakes/durable-object.js';
import { createFakeKVNamespace } from '../fakes/workers-kv.js';

// Never an entry point, and never the Durable Object registry: only
// Cloudflare can load those.
import * as nodeRegistry from './project/node-registry.generated.js';
import * as cloudflareRegistry from './project/cloudflare-registry.generated.js';
import virtualHosts from './project/virtual-hosts.js';
import * as app from './project/app/app.js';


export const PROJECT_DIRECTORY = fileURLToPath(new URL('./project/', import.meta.url));

// The build every boot runs as. A Release is assigned to it.
export const BUILD_ID = 'fixture-build';

// A made-up deploy key for the fixture, and its SHA-256. The environments
// hold only the hash, and nothing may ever print either.
export const FIXTURE_DEPLOY_KEY = 'kxdk_d68ff9b752db2b16fc4e4288bff58662244de0ffa0b58e154ec19c1d7256e39d';
export const FIXTURE_DEPLOY_KEY_HASH = '7a2831d3dd4bd497809c5122a4bf21af5ce186648aaeed0e941e3a59a5d06e1b';

// The values the fake environments give the declared secrets. No error and
// no response may ever repeat one.
export const SECRET_VALUES = {
    DEPLOY_KEY_HASH: FIXTURE_DEPLOY_KEY_HASH,
    FIXTURE_APP_SECRET: 'the-app-secret-nothing-may-print',
    PANEL_SIGNING_SECRET: 'the-panel-secret-nothing-may-print',
    VISITS_OPTIONAL_TOKEN: 'the-optional-token-nothing-may-print',
};


export function readCommittedFile(fileName) {
    return fs.readFileSync(path.join(PROJECT_DIRECTORY, fileName), 'utf8');
}

export function makeDataDirectory() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fixture-project-'));
}

export function removeDataDirectory(dataDirectory) {
    return fsp.rm(dataDirectory, { recursive: true, force: true });
}

// Stands in for node:process. exit() records its code and returns, and on()
// keeps each handler so a test can deliver a signal by calling it.
export function makeProcess(env, environment = 'test') {
    const exitCodes = [];
    const handlers = new Map();
    let resolveExited;

    const exited = new Promise((resolve) => {
        resolveExited = resolve;
    });

    return {
        argv: [ 'node', 'node-server.js', '--environment', environment, '--port', '0' ],
        env,
        exit(code) {
            exitCodes.push(code);
            resolveExited(code);
        },
        on(name, handler) {
            handlers.set(name, handler);
        },
        // Resolves with the first exit code.
        exited,
        exitCodes,
        handlers,
    };
}

// Boots the fixture the way its node-server.js does, from the committed
// registry, with a fake process and the stores in a temporary directory. The
// caller must await close(). A test may pass a changed copy of the registry,
// another environment of node-config.jsonc, a copy of the project to boot
// in place of the committed one, a `buildId` (null for a host with no
// BUILD_ID), or a `readFile` that serves a changed config.
export async function bootOnNode(registry = nodeRegistry, options = {}) {
    const {
        environment = 'test',
        baseDirectory = PROJECT_DIRECTORY,
        buildId = BUILD_ID,
        readFile,
    } = options;

    const dataDirectory = await makeDataDirectory();

    const fakeProcess = makeProcess({
        DATA_DIRECTORY: dataDirectory,
        ...(buildId === null ? {} : { BUILD_ID: buildId }),
        DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
        FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
        PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
    }, environment);

    let started;

    try {
        started = await startNodeServer({
            registry,
            virtualHosts,
            app,
            baseDirectory,
            process: fakeProcess,
            readFile,
            hostname: '127.0.0.1',
        });
    } catch (error) {
        await removeDataDirectory(dataDirectory);
        throw error;
    }

    return {
        ...started,
        fakeProcess,
        dataDirectory,
        origin: `http://127.0.0.1:${ started.server.address().port }`,

        // Forces a shutdown unless the test already caused one, waits for the
        // exit (the SQLite stores close in that sweep), and removes the
        // temporary directory.
        async close() {
            started.shutdown('test finished', { force: true });
            await fakeProcess.exited;
            await removeDataDirectory(dataDirectory);

            assertFalsy(started.server.listening);
        },
    };
}

// Builds the fixture's Worker the way its cloudflare-server.js does, from the
// committed registry, with fakes for the bindings core's manifest declares.
// `secrets` are the secret values the environment holds. A test may pass a
// changed copy of the registry, or a `buildId` (null for a Worker with no
// BUILD_ID binding).
export function bootOnCloudflare(secrets, registry = cloudflareRegistry, options = {}) {
    const { buildId = BUILD_ID } = options;

    // Workers KV allows one write per second to a key, and so does the fake.
    // A test moves this clock on between visits instead of waiting.
    const clock = { now: Date.now() };

    const env = {
        ENVIRONMENT: 'test',
        ...(buildId === null ? {} : { BUILD_ID: buildId }),
        ...secrets,
        KEY_VALUE_STORE: createFakeKVNamespace({ now: () => clock.now }),
        CA_STORE_KV_STORE: createFakeKVNamespace(),
        CA_STORE_DURABLE_OBJECT: createFakeDurableObjectNamespace((state) => {
            return new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
        }),
    };

    // Reached only when a request fails unexpectedly, which no test here
    // causes: both stay empty.
    const waits = [];
    const waitUntilPromises = [];

    // The Worker keeps its application context to itself. The app's own
    // initialize() hook is handed it, so a test can reach the services.
    let appContext = null;

    const worker = createWorker({
        env,
        sourceConfig: parseJsonc(readCommittedFile('cloudflare-config.jsonc')),
        registry,
        virtualHosts,
        app: {
            ...app,
            initialize(context) {
                appContext = context;
                return app.initialize(context);
            },
        },
        wait(milliseconds) {
            waits.push(milliseconds);
            return Promise.resolve();
        },
    });

    const executionContext = {
        waitUntil(promise) {
            waitUntilPromises.push(promise);
            promise.catch(() => {});
        },
    };

    return {
        env,
        clock,
        waits,
        waitUntilPromises,
        appContext,

        // Cloudflare hands fetch() the environment again on every request.
        fetch(pathname, headers = {}) {
            return worker.fetch(new Request(`https://localhost${ pathname }`, { headers }), env, executionContext);
        },
    };
}
