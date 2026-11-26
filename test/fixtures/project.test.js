import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, isFunction } from 'kixx-assert';

import { renderProjectFiles } from '../../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { parseJsonc } from '../../kixx/config/parse-jsonc.js';
import { parseSecretsManifest } from '../../kixx/config/secrets-manifest.js';
import { sha256Hex } from '../../kixx/utils/crypto.js';
import HttpRouter from '../../kixx/http-router/http-router.js';
import { startNodeServer } from '../../kixx/adapters/node/server/lib/node-server.js';
import { createWorker } from '../../kixx/adapters/cloudflare/server/lib/cloudflare-worker.js';
import ContentAddressableIndexStoreCore from '../../kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js';
import { createFakeDurableObjectNamespace } from '../fakes/durable-object.js';
import { createFakeKVNamespace } from '../fakes/workers-kv.js';

// Never an entry point, and never the Durable Object registry: only
// Cloudflare can load those.
import * as nodeRegistry from './project/node-registry.generated.js';
import * as cloudflareRegistry from './project/cloudflare-registry.generated.js';
import { pluginRoutes } from './project/routes.generated.js';
import virtualHosts from './project/virtual-hosts.js';
import * as app from './project/app/app.js';


const PROJECT_DIRECTORY = fileURLToPath(new URL('./project/', import.meta.url));

// Where core is, from the fixture. A real project holds it at ./kixx.
const CORE_DIRECTORY = '../../../kixx';

const REGENERATE_COMMAND = `node tools/generate-registries.js test/fixtures/project --core ${ CORE_DIRECTORY }`;

const GENERATED_FILE_NAMES = [
    'cloudflare-durable-objects.generated.js',
    'cloudflare-registry.generated.js',
    'example.env.secrets',
    'node-registry.generated.js',
    'routes.generated.js',
];


// A made-up deploy key for the fixture, and its SHA-256. The environments
// hold only the hash, and nothing may ever print either.
const FIXTURE_DEPLOY_KEY = 'kxdk_d68ff9b752db2b16fc4e4288bff58662244de0ffa0b58e154ec19c1d7256e39d';
const FIXTURE_DEPLOY_KEY_HASH = '7a2831d3dd4bd497809c5122a4bf21af5ce186648aaeed0e941e3a59a5d06e1b';

// The values the fake environments give the declared secrets. No error and
// no response may ever repeat one.
const SECRET_VALUES = {
    DEPLOY_KEY_HASH: FIXTURE_DEPLOY_KEY_HASH,
    FIXTURE_APP_SECRET: 'the-app-secret-nothing-may-print',
    PANEL_SIGNING_SECRET: 'the-panel-secret-nothing-may-print',
    VISITS_OPTIONAL_TOKEN: 'the-optional-token-nothing-may-print',
};

// What boot says on every target when the required secrets are absent. The
// fixture runs as `test`, so the deploy key hash is required too.
const MISSING_SECRETS_MESSAGE = 'Missing required environment secrets: '
    + 'DEPLOY_KEY_HASH, FIXTURE_APP_SECRET, PANEL_SIGNING_SECRET. '
    + 'Every declared secret is listed in example.env.secrets.';

// A hash that isn't 64 lowercase hex characters fails boot on every target,
// with a message that names the secret and never the value.
const MALFORMED_DEPLOY_KEY_HASH = 'not-a-hash';
const MALFORMED_DEPLOY_KEY_HASH_MESSAGE = 'DEPLOY_KEY_HASH must be the SHA-256 of the deploy key, '
    + 'as 64 lowercase hex characters.';

const CATCH_ALL_BODY = 'fixture catch-all: not found\n';

// Asks the server to close the connection after the response, so a drain that
// follows finds no connection open on either runtime.
const CLOSE_CONNECTION = { connection: 'close' };


function readCommittedFile(fileName) {
    return fs.readFileSync(path.join(PROJECT_DIRECTORY, fileName), 'utf8');
}

function readManifest(fileName) {
    return JSON.parse(fs.readFileSync(new URL(fileName, import.meta.url), 'utf8'));
}

function makeDataDirectory() {
    return fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fixture-project-'));
}

function removeDataDirectory(dataDirectory) {
    return fsp.rm(dataDirectory, { recursive: true, force: true });
}

// Stands in for node:process. exit() records its code and returns, and on()
// keeps each handler so a test can deliver a signal by calling it.
function makeProcess(env) {
    const exitCodes = [];
    const handlers = new Map();
    let resolveExited;

    const exited = new Promise((resolve) => {
        resolveExited = resolve;
    });

    return {
        argv: [ 'node', 'node-server.js', '--environment', 'test', '--port', '0' ],
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
// caller must await close().
async function bootOnNode() {
    const dataDirectory = await makeDataDirectory();

    const fakeProcess = makeProcess({
        DATA_DIRECTORY: dataDirectory,
        DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
        FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
        PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
    });

    let started;

    try {
        started = await startNodeServer({
            registry: nodeRegistry,
            virtualHosts,
            app,
            baseDirectory: PROJECT_DIRECTORY,
            process: fakeProcess,
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
// `secrets` are the secret values the environment holds.
function bootOnCloudflare(secrets) {
    // Workers KV allows one write per second to a key, and so does the fake.
    // A test moves this clock on between visits instead of waiting.
    const clock = { now: Date.now() };

    const env = {
        ENVIRONMENT: 'test',
        BUILD_ID: 'fixture-build',
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

    const worker = createWorker({
        env,
        sourceConfig: parseJsonc(readCommittedFile('cloudflare-config.jsonc')),
        registry: cloudflareRegistry,
        virtualHosts,
        app,
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

        // Cloudflare hands fetch() the environment again on every request.
        fetch(pathname, headers = {}) {
            return worker.fetch(new Request(`https://localhost${ pathname }`, { headers }), env, executionContext);
        },
    };
}

// The Publishing API cases each boot shares: no key, a wrong key, and the
// fixture's key, all on discovery. `request(pathname, headers)` sends one
// request to the booted fixture and resolves with a Response.
async function requestPublishingApi(request) {
    const read = async (headers) => {
        const response = await request('/publishing-api/v1', headers);
        const text = await response.text();

        return {
            status: response.status,
            mediaType: response.headers.get('content-type').split(';')[0],
            headers: Object.fromEntries(response.headers.entries()),
            text,
            body: JSON.parse(text),
        };
    };

    return {
        missing: await read({}),
        wrong: await read({ authorization: `Bearer kxdk_${ '0'.repeat(64) }` }),
        valid: await read({ authorization: `Bearer ${ FIXTURE_DEPLOY_KEY }` }),
    };
}

function assertPublishingApiResponses({ missing, wrong, valid }) {
    for (const refused of [ missing, wrong ]) {
        assertEqual(401, refused.status);
        assertEqual('application/vnd.api+json', refused.mediaType);
        assertEqual('DeployKeyRequired', refused.body.errors[0].code);
    }

    assertEqual(200, valid.status);
    assertEqual('application/vnd.api+json', valid.mediaType);
    assertEqual('PublishingApi', valid.body.data.type);
    assertEqual(3, valid.body.data.attributes.buildAssignmentProtocolVersion);

    assertNoSecretValue([ missing, wrong, valid ]);
}

async function fetchJSON(url) {
    const response = await fetch(url);
    const body = await response.json();

    return { response, body };
}

function assertNoSecretValue(value) {
    const text = util.inspect(value, { depth: 8 });

    for (const [ name, secretValue ] of Object.entries(SECRET_VALUES)) {
        assertFalsy(text.includes(secretValue), `the value of ${ name } was printed`);
    }

    assertFalsy(text.includes(FIXTURE_DEPLOY_KEY), 'the deploy key was printed');
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('fixture project', ({ describe }) => {

    describe('generated files', ({ before, it }) => {
        let rendered;

        before(async () => {
            rendered = await renderProjectFiles({
                fileSystem: createProjectFileSystem(PROJECT_DIRECTORY),
                coreDirectory: CORE_DIRECTORY,
            });
        });

        it('renders exactly the five generated files', () => {
            assertEqual(GENERATED_FILE_NAMES.join(','), [ ...rendered.keys() ].sort().join(','));
        });

        it('holds every generated file exactly as the generator writes it', () => {
            for (const [ fileName, text ] of rendered) {
                assert(
                    readCommittedFile(fileName) === text,
                    `test/fixtures/project/${ fileName } is out of date. Regenerate it with: ${ REGENERATE_COMMAND }`,
                );
            }
        });

        it('holds no other generated module at its root', () => {
            // cloudflare-config.generated.js is written by a deploy and is
            // never committed, here or in a real project.
            const found = fs.readdirSync(PROJECT_DIRECTORY).filter((name) => name.endsWith('.generated.js'));
            const expected = GENERATED_FILE_NAMES.filter((name) => name.endsWith('.generated.js'));

            assertEqual(expected.join(','), found.sort().join(','));
        });

        it('leaves no trace of a contribution to a plugin that isn\'t installed', () => {
            // The visits plugin contributes routes when "reports" is installed.
            for (const [ fileName, text ] of rendered) {
                assertFalsy(text.includes('reports'), `${ fileName } names the reports plugin`);
            }
        });

        it('ignores a plugins/ directory that has no manifest', () => {
            for (const [ fileName, text ] of rendered) {
                assertFalsy(text.includes('draft'), `${ fileName } names the draft directory`);
            }
        });

        it('declares the same secrets in example.env.secrets as in both registries', () => {
            const declared = parseSecretsManifest(readCommittedFile('example.env.secrets'));

            assertEqual('FIXTURE_APP_SECRET,PANEL_SIGNING_SECRET', declared.required.join(','));
            assertEqual('VISITS_OPTIONAL_TOKEN', declared.optional.join(','));
            assertEqual('DEPLOY_KEY_HASH', declared.requiredOutsideDevelopment.join(','));

            for (const registry of [ nodeRegistry, cloudflareRegistry ]) {
                assertEqual(JSON.stringify(declared), JSON.stringify(registry.secrets));
            }
        });

        it('holds the hash of its made-up deploy key', async () => {
            assertEqual(FIXTURE_DEPLOY_KEY_HASH, await sha256Hex(FIXTURE_DEPLOY_KEY));
        });
    });

    describe('registries', ({ it }) => {
        it('export the same names for both targets', () => {
            assertEqual(
                'LoggerWriter,ServerRequest,configDefaults,contentRoots,plugins,secrets,templateHelpers',
                Object.keys(nodeRegistry).sort().join(','),
            );
            assertEqual(
                Object.keys(nodeRegistry).sort().join(','),
                Object.keys(cloudflareRegistry).sort().join(','),
            );
        });

        it('order lifecycle modules: core, then visits, then panel, which depends on it', () => {
            assertEqual(
                [
                    'kixx:./content-addressable-store/plugin.js',
                    'kixx:./hyperview/plugin.js',
                    'kixx:./deploy-key/plugin.js',
                    'kixx:./adapters/node/key-value-store/plugin.js',
                    'kixx:./adapters/node/content-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./adapters/node/plugin.js',
                    'panel:./plugin.js',
                ].join('\n'),
                [ ...nodeRegistry.plugins.keys() ].join('\n'),
            );
            assertEqual(
                [
                    'kixx:./content-addressable-store/plugin.js',
                    'kixx:./hyperview/plugin.js',
                    'kixx:./deploy-key/plugin.js',
                    'kixx:./adapters/cloudflare/key-value-store/plugin.js',
                    'kixx:./adapters/cloudflare/content-store/plugin.js',
                    'visits:./plugin.js',
                    'visits:./adapters/cloudflare/plugin.js',
                    'panel:./plugin.js',
                ].join('\n'),
                [ ...cloudflareRegistry.plugins.keys() ].join('\n'),
            );
        });

        it('hold each target\'s config defaults over the defaults for all targets', () => {
            assertEqual('hello', nodeRegistry.configDefaults.VISITS.greeting);
            assertEqual('a default for Node.js', nodeRegistry.configDefaults.VISITS.platformNote);
            assertEqual('hello', cloudflareRegistry.configDefaults.VISITS.greeting);
            assertEqual('a default for Cloudflare', cloudflareRegistry.configDefaults.VISITS.platformNote);
            assertEqual('Fixture panel', nodeRegistry.configDefaults.PANEL.title);

            // Core's Cloudflare defaults name its bindings; Node.js has none.
            assertEqual('KEY_VALUE_STORE', cloudflareRegistry.configDefaults.KEY_VALUE_STORE.bindingName);
            assertFalsy(Object.hasOwn(nodeRegistry.configDefaults, 'KEY_VALUE_STORE'));
        });

        it('list the visits plugin\'s content root', () => {
            for (const registry of [ nodeRegistry, cloudflareRegistry ]) {
                assertEqual(1, registry.contentRoots.length);
                assertEqual('visits', registry.contentRoots[0].plugin);
                assertEqual('plugins/visits/pages', registry.contentRoots[0].pagesDirectory);
            }
        });
    });

    // Nothing is booted here. These checks only show that the hand-written
    // files and the generated ones fit each other.
    describe('hand-written files', ({ it }) => {
        it('mount core\'s routes first, then the plugin routes in entry order, a plugin\'s conditional routes after its own', () => {
            assertEqual('publishing-api,visits,panel-visits,panel', pluginRoutes.map(({ name }) => name).join(','));
            assertEqual(
                '/publishing-api/v1,/visits,/panel/visits,/panel',
                pluginRoutes.map(({ pattern }) => pattern).join(','),
            );
        });

        it('put middleware on the panel mount', () => {
            const panel = pluginRoutes.find(({ name }) => name === 'panel');

            assertEqual(1, panel.inboundMiddleware.length);
            assert(isFunction(panel.inboundMiddleware[0]));
        });

        it('place the plugin routes between the project\'s own routes and the catch-all', () => {
            assertEqual(1, virtualHosts.length);

            const { routes } = virtualHosts[0];

            assertEqual('home', routes[0].name);
            assertEqual(pluginRoutes.map(({ name }) => name).join(','), routes.slice(1, -1).map(({ name }) => name).join(','));
            assertEqual('*', routes.at(-1).pattern);
        });

        it('build a router', () => {
            // Building the router validates every route specification, the
            // mounted ones included.
            const router = new HttpRouter(virtualHosts);

            assert(router);
        });

        it('give the app the lifecycle hooks it uses', () => {
            assertEqual('initialize,start,stop', Object.keys(app).sort().join(','));

            for (const hook of Object.values(app)) {
                assert(isFunction(hook));
            }
        });
    });

    // The fixture's first real boot: the committed Node.js registry, the
    // Node.js adapters, SQLite stores in a temporary directory, and requests
    // over a loopback socket. Deno runs the same adapters.
    describe('booted on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let firstVisit;
        let secondVisit;
        let publishingApi;

        before(async () => {
            booted = await bootOnNode();

            // The mount path answers with and without a trailing slash.
            firstVisit = await fetchJSON(`${ booted.origin }/visits`);
            secondVisit = await fetchJSON(`${ booted.origin }/visits/`);

            publishingApi = await requestPublishingApi((pathname, headers) => {
                return fetch(`${ booted.origin }${ pathname }`, { headers });
            });
        });

        after(async () => {
            await booted.close();
        });

        it('counts visits through the key/value store', () => {
            assertEqual(200, firstVisit.response.status);
            assertEqual(1, firstVisit.body.count);
            assertEqual(200, secondVisit.response.status);
            assertEqual(2, secondVisit.body.count);
        });

        it('runs the visits plugin\'s Node.js adapter', () => {
            assertEqual('node', firstVisit.body.target);
        });

        it('lays the project\'s config over the defaults for all targets and for Node.js', () => {
            const { config } = firstVisit.body;

            // The project's override.
            assertEqual('hello from the fixture', config.greeting);

            // Defaults the project left alone.
            assertEqual('default-one,default-two', config.tags.join(','));
            assertEqual(60, config.limits.perMinute);
            assertEqual(600, config.limits.perHour);

            // A default only the Node.js target has.
            assertEqual('a default for Node.js', config.platformNote);
        });

        it('runs the middleware on the panel mount', async () => {
            const { response, body } = await fetchJSON(`${ booted.origin }/panel`);

            assertEqual(200, response.status);
            assertEqual('Fixture panel', body.title);
            assertEqual('yes', response.headers.get('x-fixture-panel'));
        });

        it('serves the routes visits contributes because panel is installed', async () => {
            const { response, body } = await fetchJSON(`${ booted.origin }/panel/visits`);

            assertEqual(200, response.status);
            assertEqual('visits', body.panel);

            // The route belongs to the visits plugin's mount, not the panel's.
            assertEqual(null, response.headers.get('x-fixture-panel'));
        });

        it('serves no route contributed to a plugin that isn\'t installed', async () => {
            const response = await fetch(`${ booted.origin }/reports/visits`);

            assertEqual(404, response.status);
            assertEqual(CATCH_ALL_BODY, await response.text());
        });

        it('answers the project\'s own route first', async () => {
            const { response, body } = await fetchJSON(`${ booted.origin }/`);

            assertEqual(200, response.status);
            assertEqual('home', body.page);
        });

        it('leaves an unknown path to the project\'s catch-all', async () => {
            const response = await fetch(`${ booted.origin }/no-such-page`);

            assertEqual(404, response.status);
            assertEqual(CATCH_ALL_BODY, await response.text());
        });

        it('registers every service the manifests declare', () => {
            const manifests = [
                readManifest('../../kixx/plugin.json'),
                readManifest('./project/plugins/visits/plugin.json'),
                readManifest('./project/plugins/panel/plugin.json'),
            ];

            for (const manifest of manifests) {
                assert(manifest.services.length > 0);

                for (const name of manifest.services) {
                    assert(booted.appContext.getService(name), `${ manifest.name } declares ${ name }`);
                }
            }
        });

        it('initializes every module, then starts them in lifecycle order', () => {
            assertEqual(
                'panel.initialize,app.initialize,visits.start,panel.start,app.start',
                booted.appContext.getService('FixtureLog').events.join(','),
            );
        });

        it('keeps its stores in DATA_DIRECTORY, not in the project', () => {
            assert(fs.existsSync(path.join(booted.dataDirectory, 'key-value-store.sqlite')));
            assertFalsy(fs.existsSync(path.join(PROJECT_DIRECTORY, 'key-value-store.sqlite')));
            assertFalsy(fs.existsSync(path.join(PROJECT_DIRECTORY, 'content-store')));
        });

        it('serves the Publishing API behind the deploy key', () => {
            assertPublishingApiResponses(publishingApi);
        });

        it('puts no secret value in a response', () => {
            assertNoSecretValue([ firstVisit.body, secondVisit.body ]);
        });
    });

    describe('shut down on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let exitCode;

        before(async () => {
            booted = await bootOnNode();

            // One request, so the stores have been used when they close.
            const response = await fetch(`${ booted.origin }/visits`, { headers: CLOSE_CONNECTION });
            await response.text();

            // SIGTERM is the deploy path: drain, stop, close, exit.
            booted.fakeProcess.handlers.get('SIGTERM')();
            exitCode = await booted.fakeProcess.exited;
        });

        after(async () => {
            await booted.close();
        });

        it('stops the app first, then the plugins in reverse', () => {
            assertEqual(
                [
                    'panel.initialize',
                    'app.initialize',
                    'visits.start',
                    'panel.start',
                    'app.start',
                    'app.stop',
                    'panel.stop',
                    'visits.stop',
                ].join(','),
                booted.appContext.getService('FixtureLog').events.join(','),
            );
        });

        it('exits 0, once', () => {
            assertEqual(0, exitCode);
            assertEqual(1, booted.fakeProcess.exitCodes.length);
        });

        it('stops listening', () => {
            assertFalsy(booted.server.listening);
        });
    });

    describe('booted on the Node.js adapters without its required secrets', ({ before, after, it }) => {
        let dataDirectory;
        let fakeProcess;
        let error;

        before(async () => {
            dataDirectory = await makeDataDirectory();

            // The optional secret is present; every required one is absent.
            fakeProcess = makeProcess({
                DATA_DIRECTORY: dataDirectory,
                VISITS_OPTIONAL_TOKEN: SECRET_VALUES.VISITS_OPTIONAL_TOKEN,
            });

            error = await catchRejection(startNodeServer({
                registry: nodeRegistry,
                virtualHosts,
                app,
                baseDirectory: PROJECT_DIRECTORY,
                process: fakeProcess,
                hostname: '127.0.0.1',
            }));
        });

        after(async () => {
            await removeDataDirectory(dataDirectory);
        });

        it('rejects with one error naming every one', () => {
            assertEqual('OperationalError', error.name);
            assertEqual(MISSING_SECRETS_MESSAGE, error.message);
        });

        it('repeats no value from the environment', () => {
            assertNoSecretValue(error);
            assertFalsy(util.inspect(error, { depth: 8 }).includes(dataDirectory));
        });

        it('opens no store, registers no signal handler, and doesn\'t exit', () => {
            assertEqual(0, fs.readdirSync(dataDirectory).length);
            assertEqual(0, fakeProcess.handlers.size);
            assertEqual(0, fakeProcess.exitCodes.length);
        });
    });

    describe('booted on the Node.js adapters with a malformed deploy key hash', ({ before, after, it }) => {
        let dataDirectory;
        let fakeProcess;
        let error;

        before(async () => {
            dataDirectory = await makeDataDirectory();

            fakeProcess = makeProcess({
                DATA_DIRECTORY: dataDirectory,
                DEPLOY_KEY_HASH: MALFORMED_DEPLOY_KEY_HASH,
                FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
            });

            error = await catchRejection(startNodeServer({
                registry: nodeRegistry,
                virtualHosts,
                app,
                baseDirectory: PROJECT_DIRECTORY,
                process: fakeProcess,
                hostname: '127.0.0.1',
            }));
        });

        after(async () => {
            await removeDataDirectory(dataDirectory);
        });

        it('rejects with the boot check\'s error, naming the secret', () => {
            assertEqual('OperationalError', error.name);
            assertEqual(MALFORMED_DEPLOY_KEY_HASH_MESSAGE, error.message);
        });

        it('repeats no value from the environment', () => {
            assertNoSecretValue(error);
            assertFalsy(util.inspect(error, { depth: 8 }).includes(MALFORMED_DEPLOY_KEY_HASH));
        });

        it('registers no signal handler and doesn\'t exit', () => {
            assertEqual(0, fakeProcess.handlers.size);
            assertEqual(0, fakeProcess.exitCodes.length);
        });
    });

    // Unit coverage of the Cloudflare registry and adapters on fakes. It is
    // not the real boot: only Cloudflare can load the entry point and the
    // Durable Object classes.
    describe('booted on the Cloudflare adapters against fakes', ({ before, it }) => {
        let booted;
        let firstVisit;
        let secondVisit;
        let publishingApi;

        before(async () => {
            booted = bootOnCloudflare({
                DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
                FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
            });

            const firstResponse = await booted.fetch('/visits');
            firstVisit = { response: firstResponse, body: await firstResponse.json() };

            booted.clock.now += 1000;

            const secondResponse = await booted.fetch('/visits/');
            secondVisit = { response: secondResponse, body: await secondResponse.json() };

            publishingApi = await requestPublishingApi(booted.fetch);
        });

        it('counts visits through the key/value store', () => {
            assertEqual(200, firstVisit.response.status);
            assertEqual(1, firstVisit.body.count);
            assertEqual(200, secondVisit.response.status);
            assertEqual(2, secondVisit.body.count);
        });

        it('keeps the count in the namespace bound as KEY_VALUE_STORE', () => {
            const puts = booted.env.KEY_VALUE_STORE.calls.filter(({ method }) => method === 'put');
            const isFailureCount = ({ key }) => key.startsWith('kixx:deploy-key-failures:');

            assertEqual(2, puts.filter((call) => !isFailureCount(call)).length);

            // One write per refused Publishing API request. The second may
            // hit KV's one-write-per-second 429; the request still got 401.
            assertEqual(2, puts.filter(isFailureCount).length);
            assertEqual(0, booted.env.CA_STORE_KV_STORE.calls.length);
        });

        it('runs the visits plugin\'s Cloudflare adapter', () => {
            assertEqual('cloudflare', firstVisit.body.target);
        });

        it('lays the project\'s config over the defaults for all targets and for Cloudflare', () => {
            const { config } = firstVisit.body;

            assertEqual('hello from the fixture', config.greeting);
            assertEqual('default-one,default-two', config.tags.join(','));
            assertEqual(60, config.limits.perMinute);
            assertEqual(600, config.limits.perHour);

            // A default only the Cloudflare target has.
            assertEqual('a default for Cloudflare', config.platformNote);
        });

        it('serves the same mounted routes as the Node.js boot', async () => {
            const panel = await booted.fetch('/panel');

            assertEqual(200, panel.status);
            assertEqual('yes', panel.headers.get('x-fixture-panel'));
            assertEqual('Fixture panel', (await panel.json()).title);

            const panelVisits = await booted.fetch('/panel/visits');

            assertEqual(200, panelVisits.status);
            assertEqual('visits', (await panelVisits.json()).panel);

            const reports = await booted.fetch('/reports/visits');

            assertEqual(404, reports.status);
            assertEqual(CATCH_ALL_BODY, await reports.text());
        });

        it('serves the Publishing API behind the deploy key', () => {
            assertPublishingApiResponses(publishingApi);
        });

        it('never reaches the Worker\'s own error path', () => {
            assertEqual(0, booted.waits.length);
            assertEqual(0, booted.waitUntilPromises.length);
        });

        it('puts no secret value in a response', () => {
            assertNoSecretValue([ firstVisit.body, secondVisit.body ]);
        });
    });

    describe('booted on the Cloudflare adapters with a malformed deploy key hash', ({ it }) => {
        it('throws the error the Node.js boot rejects with', () => {
            const error = catchError(() => {
                bootOnCloudflare({
                    DEPLOY_KEY_HASH: MALFORMED_DEPLOY_KEY_HASH,
                    FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                    PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
                });
            });

            assertEqual('OperationalError', error.name);
            assertEqual(MALFORMED_DEPLOY_KEY_HASH_MESSAGE, error.message);
            assertNoSecretValue(error);
            assertFalsy(util.inspect(error, { depth: 8 }).includes(MALFORMED_DEPLOY_KEY_HASH));
        });
    });

    describe('booted on the Cloudflare adapters without its required secrets', ({ it }) => {
        it('throws the error the Node.js boot rejects with', () => {
            // The optional secret is present; every required one is absent.
            const error = catchError(() => {
                bootOnCloudflare({ VISITS_OPTIONAL_TOKEN: SECRET_VALUES.VISITS_OPTIONAL_TOKEN });
            });

            assertEqual('OperationalError', error.name);
            assertEqual(MISSING_SECRETS_MESSAGE, error.message);
            assertNoSecretValue(error);
        });
    });
});
