// Assembles a project in a temporary directory and boots it for the tests
// beside this file. It is not a test file: the runner collects only
// `*.test.js`.
//
// Everything a boot uses is loaded from the assembled project, its own copy
// of core included: two copies of a class don't share identity. Only the
// fakes of platform services come from this repository.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFalsy } from 'kixx-assert';

import { assembleProject } from '../../tools/lib/assemble-project.js';
import { createFakeDurableObjectNamespace } from '../fakes/durable-object.js';
import { createFakeKVNamespace } from '../fakes/workers-kv.js';


// A made-up deploy key and its SHA-256. An environment holds only the hash,
// and nothing may ever print either.
export const DEPLOY_KEY = 'kxdk_4f1c8e0b7a6d5c3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e';
export const DEPLOY_KEY_HASH = '66ffb7afff7e47ddf405d25f428781d673ddb39816223c34cda06725a8b8d594';

// The build every boot outside development runs as.
export const BUILD_ID = 'skeleton-build';


/**
 * Assembles a project into a new temporary directory and loads its modules.
 * Assemble once per test file, and await remove() when the file is done.
 *
 * @param {Function} [assemble] - Builds the project: assembleProject() by default, or assembleTestApp()
 * @returns {Promise<Object>} The project: its directory, the files written, its modules, and remove()
 */
export async function assembleAndLoad(assemble = (targetDirectory) => assembleProject({ targetDirectory })) {
    const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-assembled-project-'));
    const directory = path.join(temporaryDirectory, 'project');

    try {
        const written = await assemble(directory);

        // Never an entry point, and never the Durable Object registry:
        // only Cloudflare can load those.
        const load = (name) => import(pathToFileURL(path.join(directory, ...name.split('/'))).href);

        const [
            nodeRegistry,
            cloudflareRegistry,
            { default: virtualHosts },
            app,
            { startNodeServer },
            { createWorker },
            { parseJsonc },
            { default: ContentAddressableIndexStoreCore },
            tooling,
            { createProjectFileSystem },
            { createFileSystemContentSource },
            { listContentDirectories },
        ] = await Promise.all([
            load('node-registry.generated.js'),
            load('cloudflare-registry.generated.js'),
            load('virtual-hosts.js'),
            load('app/app.js'),
            load('kixx/adapters/node/server/lib/node-server.js'),
            load('kixx/adapters/cloudflare/server/lib/cloudflare-worker.js'),
            load('kixx/config/parse-jsonc.js'),
            load('kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js'),
            load('kixx/tooling/mod.js'),
            load('kixx/adapters/node/tooling/lib/project-file-system.js'),
            load('kixx/adapters/node/content-compiler/lib/file-system-content-source.js'),
            load('kixx/content-compiler/mod.js'),
        ]);

        return {
            directory,

            // Beside the project, and removed with it: for a data directory.
            temporaryDirectory,
            written,
            nodeRegistry,
            cloudflareRegistry,
            virtualHosts,
            app,
            startNodeServer,
            createWorker,
            parseJsonc,
            ContentAddressableIndexStoreCore,
            tooling,
            createProjectFileSystem,
            createFileSystemContentSource,
            listContentDirectories,

            readFile(name) {
                return fs.readFileSync(path.join(directory, ...name.split('/')), 'utf8');
            },

            remove() {
                return fsp.rm(temporaryDirectory, { recursive: true, force: true });
            },
        };
    } catch (error) {
        await fsp.rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
    }
}

// Every content file of the project, by its path from the project root.
export async function readContentFiles(project) {
    const source = project.createFileSystemContentSource(project.directory);
    const files = {};

    for (const directory of project.listContentDirectories(project.nodeRegistry.contentRoots)) {
        const { entries } = await source.listFiles(directory);

        for (const entry of entries) {
            const filepath = `${ directory }/${ entry.path }`;
            files[filepath] = new Uint8Array(await source.readFile(filepath));
        }
    }

    return files;
}

// The project's own logger writer, writing to an array in place of the
// terminal: the skeleton's config logs at DEBUG and INFO.
function withCapturedLogs(registry, lines) {
    const write = (line) => lines.push(String(line));

    class CapturingLoggerWriter extends registry.LoggerWriter {
        constructor() {
            super({
                // The Node.js writer's sinks.
                stdout: { write },
                stderr: { write },
                // The Cloudflare writer's sink.
                console: { debug: write, info: write, warn: write, error: write },
            });
        }
    }

    return { ...registry, LoggerWriter: CapturingLoggerWriter };
}

// Stands in for node:process. exit() records its code and returns, and on()
// keeps each handler so a test can deliver a signal by calling it.
function makeProcess(env, environment) {
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

/**
 * Boots the project the way its node-server.js does, with a fake process.
 * The caller must await close().
 *
 * @param {Object} project - What assembleAndLoad() resolved
 * @param {Object} [options]
 * @param {string} [options.environment='development']
 * @param {Object} [options.env] - The whole process environment. Nothing is added to it.
 * @returns {Promise<Object>} What startNodeServer() resolved, with fakeProcess, logLines, origin, and close()
 */
export async function bootOnNode(project, options = {}) {
    const { environment = 'development', env = {} } = options;
    const fakeProcess = makeProcess(env, environment);
    const logLines = [];

    const started = await project.startNodeServer({
        registry: withCapturedLogs(project.nodeRegistry, logLines),
        virtualHosts: project.virtualHosts,
        app: project.app,
        baseDirectory: project.directory,
        process: fakeProcess,
        hostname: '127.0.0.1',
    });

    return {
        ...started,
        fakeProcess,
        logLines,
        origin: `http://127.0.0.1:${ started.server.address().port }`,

        // Forces a shutdown unless the test already caused one, and waits
        // for the exit: the SQLite stores close in that sweep.
        async close() {
            started.shutdown('test finished', { force: true });
            await fakeProcess.exited;

            assertFalsy(started.server.listening);
        },
    };
}

/**
 * Builds the project's Worker the way its cloudflare-server.js does, with
 * fakes for the three bindings core's manifest declares and the config
 * parsed from the project's cloudflare-config.jsonc. Nothing listens: the
 * Worker is called directly.
 *
 * @param {Object} project - What assembleAndLoad() resolved
 * @param {Object} [options]
 * @param {Object} [options.env] - Variables and secrets, beside the bindings
 * @returns {Object} The bindings' env, logLines, and a fetch(url, init) with the signature of the global one
 */
export function bootOnCloudflare(project, options = {}) {
    const env = {
        ...options.env,
        KEY_VALUE_STORE: createFakeKVNamespace(),
        CA_STORE_KV_STORE: createFakeKVNamespace(),
        CA_STORE_DURABLE_OBJECT: createFakeDurableObjectNamespace((state) => {
            return new project.ContentAddressableIndexStoreCore({ ctx: state, env: {} });
        }),
    };

    const logLines = [];

    const worker = project.createWorker({
        env,
        sourceConfig: project.parseJsonc(project.readFile('cloudflare-config.jsonc')),
        registry: withCapturedLogs(project.cloudflareRegistry, logLines),
        virtualHosts: project.virtualHosts,
        app: project.app,
        wait() {
            return Promise.resolve();
        },
    });

    const executionContext = {
        waitUntil(promise) {
            promise.catch(() => {});
        },
    };

    return {
        env,
        logLines,
        origin: 'https://localhost',

        // Cloudflare hands fetch() the environment again on every request.
        fetch(url, init) {
            return worker.fetch(new Request(url, init), env, executionContext);
        },
    };
}
