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
import { parseSecretsManifest } from '../../kixx/config/secrets-manifest.js';
import HttpRouter from '../../kixx/http-router/http-router.js';
import { startNodeServer } from '../../kixx/adapters/node/server/lib/node-server.js';

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


// The values the fake environments give the declared secrets. No error and
// no response may ever repeat one.
const SECRET_VALUES = {
    FIXTURE_APP_SECRET: 'the-app-secret-nothing-may-print',
    PANEL_SIGNING_SECRET: 'the-panel-secret-nothing-may-print',
    VISITS_OPTIONAL_TOKEN: 'the-optional-token-nothing-may-print',
};

// What boot says on every target when both required secrets are absent.
const MISSING_SECRETS_MESSAGE = 'Missing required environment secrets: FIXTURE_APP_SECRET, PANEL_SIGNING_SECRET. '
    + 'Every declared secret is listed in example.env.secrets.';

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

            for (const registry of [ nodeRegistry, cloudflareRegistry ]) {
                assertEqual(declared.required.join(','), registry.secrets.required.join(','));
                assertEqual(declared.optional.join(','), registry.secrets.optional.join(','));
            }
        });
    });

    describe('registries', ({ it }) => {
        it('export the same names for both targets', () => {
            assertEqual(
                'LoggerWriter,ServerRequest,configDefaults,contentRoots,plugins,secrets',
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
        it('mount the plugin routes in entry order, a plugin\'s conditional routes after its own', () => {
            assertEqual('visits,panel-visits,panel', pluginRoutes.map(({ name }) => name).join(','));
            assertEqual('/visits,/panel/visits,/panel', pluginRoutes.map(({ pattern }) => pattern).join(','));
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

        before(async () => {
            booted = await bootOnNode();

            // The mount path answers with and without a trailing slash.
            firstVisit = await fetchJSON(`${ booted.origin }/visits`);
            secondVisit = await fetchJSON(`${ booted.origin }/visits/`);
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

            // The optional secret is present; both required ones are absent.
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

        it('rejects with one error naming both', () => {
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
});
