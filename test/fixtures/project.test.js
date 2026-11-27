import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertFalsy, isFunction } from 'kixx-assert';

import { renderProjectFiles } from '../../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../../kixx/adapters/node/tooling/lib/project-file-system.js';
import { parseJsonc } from '../../kixx/config/parse-jsonc.js';
import { parseSecretsManifest } from '../../kixx/config/secrets-manifest.js';
import { sha256Hex } from '../../kixx/utils/crypto.js';
import HttpRouter from '../../kixx/http-router/http-router.js';
import HyperviewService from '../../kixx/hyperview/hyperview-service.js';
import { startNodeServer } from '../../kixx/adapters/node/server/lib/node-server.js';

// Never an entry point, and never the Durable Object registry: only
// Cloudflare can load those.
import * as nodeRegistry from './project/node-registry.generated.js';
import * as cloudflareRegistry from './project/cloudflare-registry.generated.js';
import { pluginRoutes } from './project/routes.generated.js';
import virtualHosts from './project/virtual-hosts.js';
import * as app from './project/app/app.js';
import {
    FIXTURE_DEPLOY_KEY,
    FIXTURE_DEPLOY_KEY_HASH,
    PROJECT_DIRECTORY,
    SECRET_VALUES,
    bootOnCloudflare,
    bootOnNode,
    makeDataDirectory,
    makeProcess,
    readCommittedFile,
    removeDataDirectory,
} from './fixture-project-boot.js';


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

// What boot says on every target when CONTENT_STORE.workingTree is true
// outside development. The fixture boots as `test`.
const WORKING_TREE_REFUSED_MESSAGE = 'CONTENT_STORE.workingTree can be true only in the development environment, '
    + 'and this is "test". Remove the key or set it to false.';

// The catch-all serves content. These boots assign no Release to the build,
// so it answers 503. test/fixtures/project-pages.test.js assigns one.
const NO_RELEASE_CODE = 'BuildNotServable';

// Asks the server to close the connection after the response, so a drain that
// follows finds no connection open on either runtime.
const CLOSE_CONNECTION = { connection: 'close' };


function readManifest(fileName) {
    return JSON.parse(fs.readFileSync(new URL(fileName, import.meta.url), 'utf8'));
}

// A copy of a registry whose config defaults set CONTENT_STORE.workingTree,
// as a project's config would. The committed config files stay as they are.
function withWorkingTreeAskedFor(registry) {
    return {
        ...registry,
        configDefaults: {
            ...registry.configDefaults,
            CONTENT_STORE: { ...registry.configDefaults.CONTENT_STORE, workingTree: true },
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
    assertEqual(4, valid.body.data.attributes.buildAssignmentProtocolVersion);

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

            // Core's Cloudflare defaults name its bindings, and its Node.js
            // defaults say where the stores live (OP-C).
            assertEqual('KEY_VALUE_STORE', cloudflareRegistry.configDefaults.KEY_VALUE_STORE.bindingName);
            assertFalsy(Object.hasOwn(cloudflareRegistry.configDefaults.KEY_VALUE_STORE, 'path'));
            assertEqual('data/key-value-store.sqlite', nodeRegistry.configDefaults.KEY_VALUE_STORE.path);
            assertEqual('data/content-store', nodeRegistry.configDefaults.CONTENT_STORE.rootDirectory);
        });

        it('list every declared template helper: core\'s, the visits plugin\'s, and the app\'s', () => {
            assertEqual(
                [
                    'assetUrl', 'each', 'fixtureGreeting', 'formatDate', 'if', 'ifEqual', 'markup',
                    'plusOne', 'truncate', 'unescape', 'unless', 'visitCount', 'with',
                ].join(','),
                nodeRegistry.templateHelpers.join(','),
            );
            assertEqual(nodeRegistry.templateHelpers.join(','), cloudflareRegistry.templateHelpers.join(','));
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

            assertEqual('home,fingerprinted-assets', routes.slice(0, 2).map(({ name }) => name).join(','));
            assertEqual(pluginRoutes.map(({ name }) => name).join(','), routes.slice(2, -1).map(({ name }) => name).join(','));
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
            // No route matches, so the request falls to the catch-all.
            const { response, body } = await fetchJSON(`${ booted.origin }/reports/visits`);

            assertEqual(503, response.status);
            assertEqual(NO_RELEASE_CODE, body.errors[0].code);
        });

        it('answers the project\'s own route first', async () => {
            const { response, body } = await fetchJSON(`${ booted.origin }/`);

            assertEqual(200, response.status);
            assertEqual('home', body.page);
        });

        it('leaves an unknown path to the project\'s catch-all', async () => {
            const { response, body } = await fetchJSON(`${ booted.origin }/no-such-page`);

            assertEqual(503, response.status);
            assertEqual(NO_RELEASE_CODE, body.errors[0].code);
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

        // The fixture's config names no store path: these are core's
        // defaults (OP-C), resolved under DATA_DIRECTORY.
        it('keeps its stores under data/ in DATA_DIRECTORY, not in the project', () => {
            assert(fs.existsSync(path.join(booted.dataDirectory, 'data', 'key-value-store.sqlite')));
            assert(fs.existsSync(path.join(booted.dataDirectory, 'data', 'content-store')));
            assertFalsy(fs.existsSync(path.join(PROJECT_DIRECTORY, 'data')));
        });

        it('serves the Publishing API behind the deploy key', () => {
            assertPublishingApiResponses(publishingApi);
        });

        it('puts no secret value in a response', () => {
            assertNoSecretValue([ firstVisit.body, secondVisit.body ]);
        });
    });

    describe('booted on the Node.js adapters with its own store paths', ({ before, after, it }) => {
        let booted;

        before(async () => {
            // The committed config, with a store path of the project's own
            // in the environment the fixture boots as.
            const readFile = (filepath) => {
                const source = fs.readFileSync(filepath, 'utf8');

                if (path.basename(filepath) !== 'node-config.jsonc') {
                    return source;
                }

                const sourceConfig = parseJsonc(source);

                sourceConfig.environments.test.KEY_VALUE_STORE = { path: 'my-stores/kv.sqlite' };
                sourceConfig.environments.test.CONTENT_STORE = { rootDirectory: 'my-stores/content' };

                return JSON.stringify(sourceConfig);
            };

            booted = await bootOnNode(nodeRegistry, { readFile });

            // One request to each store: both create their files on first
            // use. No Release is assigned, so the page answers 503.
            for (const pathname of [ '/visits', '/about' ]) {
                const response = await fetch(`${ booted.origin }${ pathname }`);
                await response.text();
            }
        });

        after(async () => {
            await booted.close();
        });

        it('keeps its stores where the project\'s config says, not at the defaults', () => {
            assert(fs.existsSync(path.join(booted.dataDirectory, 'my-stores', 'kv.sqlite')));
            assert(fs.existsSync(path.join(booted.dataDirectory, 'my-stores', 'content')));
            assertFalsy(fs.existsSync(path.join(booted.dataDirectory, 'data')));
        });
    });

    // OP-B: a host with no BUILD_ID can serve no Release. It answers 503 and
    // keeps running, so the Publishing API stays reachable.
    describe('booted on the Node.js adapters without a BUILD_ID', ({ before, after, it }) => {
        let booted;
        let firstPage;
        let secondPage;
        let discovery;

        before(async () => {
            booted = await bootOnNode(nodeRegistry, { buildId: null });

            firstPage = await fetchJSON(`${ booted.origin }/about`);
            secondPage = await fetchJSON(`${ booted.origin }/about`);

            const response = await fetch(`${ booted.origin }/publishing-api/v1`, {
                headers: { authorization: `Bearer ${ FIXTURE_DEPLOY_KEY }` },
            });

            discovery = { status: response.status, body: await response.json() };
        });

        after(async () => {
            await booted.close();
        });

        it('answers a page request with 503, twice', () => {
            for (const { response, body } of [ firstPage, secondPage ]) {
                assertEqual(503, response.status);
                assertEqual(NO_RELEASE_CODE, body.errors[0].code);
            }
        });

        it('keeps running', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });

        it('still answers the Publishing API, which reports no running build', () => {
            assertEqual(200, discovery.status);
            assertEqual(null, discovery.body.data.attributes.runningBuildId);
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

    describe('booted on the Node.js adapters with the working tree asked for outside development', ({ before, after, it }) => {
        let dataDirectory;
        let fakeProcess;
        let error;

        before(async () => {
            dataDirectory = await makeDataDirectory();

            fakeProcess = makeProcess({
                DATA_DIRECTORY: dataDirectory,
                DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
                FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
            });

            error = await catchRejection(startNodeServer({
                registry: withWorkingTreeAskedFor(nodeRegistry),
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

        it('rejects with core\'s boot check, naming the key and the environment', () => {
            assertEqual('OperationalError', error.name);
            assertEqual(WORKING_TREE_REFUSED_MESSAGE, error.message);
        });

        it('opens no store, registers no signal handler, and doesn\'t exit', () => {
            assertEqual(0, fs.readdirSync(dataDirectory).length);
            assertEqual(0, fakeProcess.handlers.size);
            assertEqual(0, fakeProcess.exitCodes.length);
        });
    });

    // OP-B on Cloudflare: 503, not the 500 an unexpected error gets.
    describe('booted on the Cloudflare adapters against fakes without a BUILD_ID', ({ before, it }) => {
        let page;

        before(async () => {
            const booted = bootOnCloudflare({
                DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
                FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
            }, cloudflareRegistry, { buildId: null });
            const response = await booted.fetch('/about');

            page = { status: response.status, body: await response.json() };
        });

        it('answers a page request with 503', () => {
            assertEqual(503, page.status);
            assertEqual(NO_RELEASE_CODE, page.body.errors[0].code);
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

            assertEqual(503, reports.status);
            assertEqual(NO_RELEASE_CODE, (await reports.json()).errors[0].code);
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

    // Boot compares the registry's declared template helpers with the ones
    // registered. The fixture's log level is NONE, so these read what the
    // comparison returned, not the log.
    describe('template helper declarations at boot', ({ before, after, it }) => {
        const tracker = new MockTracker();
        const CLOUDFLARE_SECRETS = {
            DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
            FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
            PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
        };

        let report;

        // The registry as it would be if the visits plugin's manifest didn't
        // declare its helper. No fixture file changes.
        function withoutVisitsHelper(registry) {
            return {
                ...registry,
                templateHelpers: registry.templateHelpers.filter((name) => name !== 'visitCount'),
            };
        }

        function lastResult() {
            return report.mock.getCall(report.mock.callCount() - 1).result;
        }

        async function bootAndCloseOnNode(registry) {
            const booted = await bootOnNode(registry);
            await booted.close();
        }

        before(() => {
            // Calls through to the real method and records what it returned.
            report = tracker.method(HyperviewService.prototype, 'reportTemplateHelperDifferences');
        });

        after(() => {
            tracker.reset();
        });

        it('reports no difference on Node.js', async () => {
            const callsBefore = report.mock.callCount();

            await bootAndCloseOnNode();

            assertEqual(callsBefore + 1, report.mock.callCount());
            assertEqual('{"undeclared":[],"unregistered":[]}', JSON.stringify(lastResult()));
        });

        it('reports no difference on Cloudflare', () => {
            const callsBefore = report.mock.callCount();

            bootOnCloudflare(CLOUDFLARE_SECRETS);

            assertEqual(callsBefore + 1, report.mock.callCount());
            assertEqual('{"undeclared":[],"unregistered":[]}', JSON.stringify(lastResult()));
        });

        it('reports an undeclared helper on Node.js, and still boots', async () => {
            await bootAndCloseOnNode(withoutVisitsHelper(nodeRegistry));

            assertEqual('{"undeclared":["visitCount"],"unregistered":[]}', JSON.stringify(lastResult()));
        });

        it('reports an undeclared helper on Cloudflare, and still boots', async () => {
            const booted = bootOnCloudflare(CLOUDFLARE_SECRETS, withoutVisitsHelper(cloudflareRegistry));

            assertEqual('{"undeclared":["visitCount"],"unregistered":[]}', JSON.stringify(lastResult()));

            const response = await booted.fetch('/visits');

            assertEqual(200, response.status);
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

    describe('booted on the Cloudflare adapters with the working tree asked for outside development', ({ it }) => {
        it('throws the error the Node.js boot rejects with', () => {
            const error = catchError(() => {
                bootOnCloudflare(SECRET_VALUES, withWorkingTreeAskedFor(cloudflareRegistry));
            });

            assertEqual('OperationalError', error.name);
            assertEqual(WORKING_TREE_REFUSED_MESSAGE, error.message);
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
