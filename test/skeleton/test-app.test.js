import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import IntegrationProbeSqlStoreCore from '../../test-app/integration-probe/adapters/cloudflare/lib/integration-probe-sql-store-core.js';
import { comparePlatformObservation } from '../../test-app/integration-probe/lib/platform-expectations.js';
import { createFakeDurableObjectNamespace } from '../fakes/durable-object.js';
import { createProbeClient } from '../../test-app/probe/probe-client.js';
import { publishTestAppContent } from '../../test-app/test/test-helpers/publish.js';
import { assembleTestApp } from '../../tools/lib/assemble-project.js';
import {
    BUILD_ID,
    DEPLOY_KEY,
    DEPLOY_KEY_HASH,
    assembleAndLoad,
    bootOnCloudflare,
    bootOnNode,
} from './assembled-project-boot.js';


const SKELETON_DIRECTORY = fileURLToPath(new URL('../../devkit/templates/project/', import.meta.url));

const PROBE_PATHNAME = '/integration-probe/probe';
const ENVIRONMENT_PATHNAME = '/integration-probe/environment';

const PLATFORM_CHECKS_PATHNAME = '/integration-probe/platform-checks';
const PLATFORM_CHECKS = [ 'kv-get-empty-array', 'sql-transaction-rollback', 'environment-bindings' ];

// The page the plugin's content root supplies.
const PLUGIN_PAGE_PATHNAME = '/integration-probe-page';

// Hyperview's rendered-page cache keys, in the key/value store.
const PAGE_CACHE_PREFIX = 'hyperview_page_cache#';

// One test that only reads, and one that writes and reads back.
const READ_TEST = 'resolves null for a missing key';
const WRITE_TEST = 'round-trips a text value by default';


// Every file under a directory, at any depth, as sorted POSIX paths
// relative to it.
function listFiles(directory) {
    return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .sort();
}

async function fetchJSON(fetch, url, deployKey) {
    const response = await fetch(url, {
        headers: deployKey ? { authorization: `Bearer ${ deployKey }` } : {},
    });

    return { status: response.status, body: await response.json() };
}

// What a target must answer through the probe, read through a fetch
// function.
async function useProbe(fetch, origin, testNames) {
    const client = createProbeClient({ url: `${ origin }${ PROBE_PATHNAME }`, deployKey: DEPLOY_KEY, fetch });
    const tests = await client.listTests('key-value-store');
    const results = [];

    for (const name of testNames) {
        results.push(await client.runTest('key-value-store', tests.find((testPath) => testPath.at(-1) === name)));
    }

    // A content store is built inside the request, after boot. Its first
    // test builds one.
    const [ contentStoreTest ] = await client.listTests('content-store');

    results.push(await client.runTest('content-store', contentStoreTest));

    return {
        tests,
        results,
        withoutKey: await fetchJSON(fetch, `${ origin }${ PROBE_PATHNAME }?suite=key-value-store`, null),
        environment: await fetchJSON(fetch, `${ origin }${ ENVIRONMENT_PATHNAME }`, DEPLOY_KEY),
        home: await fetchJSON(fetch, `${ origin }/`, null),
    };
}

function assertProbe({ tests, results, withoutKey, environment, home }, target) {
    assert(tests.length > 0, 'the probe listed no key-value-store test');

    for (const result of results) {
        assertEqual('passed', result.status, result.error?.message);
    }

    assertEqual(401, withoutKey.status);
    assertEqual('DeployKeyRequired', withoutKey.body.errors[0].code);

    assertEqual(200, environment.status);
    assertEqual(JSON.stringify({ target, environment: 'production', buildId: BUILD_ID }), JSON.stringify(environment.body));

    // The skeleton's pages are behind the same catch-all as in a project
    // with no plugins: no Release is assigned, so the build can't serve.
    assertEqual(503, home.status);
    assertEqual('BuildNotServable', home.body.errors[0].code);
}

// Assembling copies about 250 files, which a busy CI runner doesn't always
// do inside the default second. Every block here gets this much.
const TIMEOUT = { timeout: 5000 };


// The integration suite's test app: the skeleton, core, and the
// integration-probe plugin, assembled once for this file and booted the
// way the core-only project is. The integration suite runs it on real
// hosts.
describe('test app', ({ before, after, describe, it }) => {
    let project;

    before(async () => {
        project = await assembleAndLoad(assembleTestApp);
    });

    after(async () => {
        await project.remove();
    });

    it('holds every skeleton file byte for byte, but for cloudflare-config.jsonc', () => {
        const names = listFiles(SKELETON_DIRECTORY);

        assert(names.length > 0);

        for (const name of names) {
            const built = project.readFile(name === 'gitignore' ? '.gitignore' : name);
            const same = built === fs.readFileSync(path.join(SKELETON_DIRECTORY, ...name.split('/')), 'utf8');

            assertEqual(name !== 'cloudflare-config.jsonc', same, `${ name }: unexpected ${ same ? 'match' : 'difference' }`);
        }
    });

    it('names its own Cloudflare resources', () => {
        const config = project.parseJsonc(project.readFile('cloudflare-config.jsonc'));

        assertEqual('kixx-test-app', config.name);
        assertEqual('kixx-test-app', config.environments.production.WORKER.name);
    });

    it('holds the plugin, the probe, and the suites the probe runs', () => {
        for (const name of [
            'plugins/integration-probe/plugin.json',
            'plugins/integration-probe/routes.js',
            'plugins/integration-probe/adapters/node/plugin.js',
            'plugins/integration-probe/adapters/cloudflare/plugin.js',
            'test-app/probe/probe-handler.js',
            'test-app/probe/probe-suites.js',
            'test/kixx/key-value-store/key-value-store-conformance.js',
            'test/kixx/content-addressable-store/content-store-conformance.js',
        ]) {
            assert(project.written.includes(name), `${ name } was not written`);
        }
    });

    it('lists the plugin\'s pages as a content root', () => {
        assertEqual(
            JSON.stringify([ { plugin: 'integration-probe', pagesDirectory: 'plugins/integration-probe/pages' } ]),
            JSON.stringify(project.nodeRegistry.contentRoots),
        );
    });

    // Read as text: only Cloudflare can load it.
    it('exports core\'s Durable Object class and the plugin\'s from the generated registry', () => {
        const source = project.readFile('cloudflare-durable-objects.generated.js');
        const exported = [ ...source.matchAll(/^export \{ default as (\w+) \} from "([^"]+)";$/gm) ]
            .map(([ , className, module ]) => `${ className } ${ module }`);

        assertEqual(
            [
                'ContentAddressableIndexStore ./kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store.js',
                'IntegrationProbeSqlStore ./plugins/integration-probe/adapters/cloudflare/lib/integration-probe-sql-store.js',
            ].join('\n'),
            exported.join('\n'),
        );
    });

    it('gives the plugin\'s Durable Object a binding name on Cloudflare only', () => {
        assertEqual(
            'INTEGRATION_PROBE_SQL_STORE',
            project.cloudflareRegistry.configDefaults.INTEGRATION_PROBE.durableObject.bindingName,
        );
        assertEqual(undefined, project.nodeRegistry.configDefaults.INTEGRATION_PROBE);
    });

    it('wires the plugin through the generated registries', () => {
        assert(project.nodeRegistry.plugins.has('integration-probe:./adapters/node/plugin.js'));
        assert(project.cloudflareRegistry.plugins.has('integration-probe:./adapters/cloudflare/plugin.js'));
        assertMatches('./plugins/integration-probe/routes.js', project.readFile('routes.generated.js'));
    });

    describe('in production on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let used;
        let published;
        let home;
        let pluginPage;
        let held;
        let cachedPages;
        let platformCheck;

        before(async () => {
            booted = await bootOnNode(project, {
                environment: 'production',
                env: {
                    DATA_DIRECTORY: path.join(project.temporaryDirectory, 'data'),
                    BUILD_ID,
                    DEPLOY_KEY_HASH,
                },
            });

            used = await useProbe(fetch, booted.origin, [ READ_TEST, WRITE_TEST ]);

            // After the probe: a publish ends the 503 it looks for.
            published = await publishTestAppContent({}, { baseUrl: booted.origin, deployKey: DEPLOY_KEY });

            home = await fetch(`${ booted.origin }/`);
            await home.arrayBuffer();

            const response = await fetch(`${ booted.origin }${ PLUGIN_PAGE_PATHNAME }`);

            pluginPage = { status: response.status, text: await response.text() };

            held = await fetchJSON(fetch, `${ booted.origin }/integration-probe/hold?ms=20`, DEPLOY_KEY);

            cachedPages = await fetchJSON(
                fetch,
                `${ booted.origin }/integration-probe/key-value-keys?prefix=${ encodeURIComponent(PAGE_CACHE_PREFIX) }`,
                DEPLOY_KEY,
            );

            platformCheck = await fetch(`${ booted.origin }${ PLATFORM_CHECKS_PATHNAME }/kv-get-empty-array`, {
                method: 'POST',
                headers: { authorization: `Bearer ${ DEPLOY_KEY }` },
            });

            await platformCheck.arrayBuffer();
        });

        after(async () => {
            await booted.close();
        });

        it('runs probe tests with the deploy key, refuses without it, and says what it is', () => {
            assertProbe(used, 'node');
        });

        it('takes the integration suite\'s publish as a pre-stage of the running build', () => {
            assertEqual('prestage', published.intent);
            assertEqual(BUILD_ID, published.buildId);
        });

        it('renders the skeleton\'s home page and the plugin\'s page from the Release', () => {
            assertEqual(200, home.status);
            assertEqual(200, pluginPage.status);
            assertMatches('<h1>Integration probe page</h1>', pluginPage.text);
            assertMatches('<title>Integration probe page</title>', pluginPage.text);
        });

        it('holds a request for the time asked', () => {
            assertEqual(200, held.status);
            assertEqual(20, held.body.held);
        });

        it('has no platform check: those are Cloudflare\'s', () => {
            assertEqual(404, platformCheck.status);
        });

        it('counts no page cache key: the page cache is off by default', () => {
            assertEqual(200, cachedPages.status);
            assertEqual(0, cachedPages.body.count);
        });

        it('keeps the server running', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });
    });

    // No BUILD_ID, no secret, and no publish: the working tree is the
    // content, and the plugin's routes are open.
    describe('in development on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let pluginPage;
        let environment;

        before(async () => {
            booted = await bootOnNode(project, {
                environment: 'development',
                env: { DATA_DIRECTORY: path.join(project.temporaryDirectory, 'development-data') },
            });

            const response = await fetch(`${ booted.origin }${ PLUGIN_PAGE_PATHNAME }`);

            pluginPage = { status: response.status, text: await response.text() };
            environment = await fetchJSON(fetch, `${ booted.origin }${ ENVIRONMENT_PATHNAME }`, null);
        });

        after(async () => {
            await booted.close();
        });

        it('renders the plugin\'s page from the working tree, in the project\'s base template', () => {
            assertEqual(200, pluginPage.status);
            assertMatches('<h1>Integration probe page</h1>', pluginPage.text);
            assertMatches('<title>Integration probe page</title>', pluginPage.text);
        });

        it('opens the plugin\'s routes with no deploy key', () => {
            assertEqual(200, environment.status);
            assertEqual(
                JSON.stringify({ target: 'node', environment: 'development', buildId: null }),
                JSON.stringify(environment.body),
            );
        });
    });

    // Nothing listens: the Worker is called directly. The write test isn't
    // run here: it waits a real second through the Workers scheduler, which
    // only Cloudflare has. The Cloudflare factories run every test against
    // fakes in test/test-app/integration-probe/.
    describe('in production as a Worker against fakes', ({ before, it }) => {
        let used;
        const platformChecks = [];

        before(async () => {
            const booted = bootOnCloudflare(project, {
                env: {
                    ENVIRONMENT: 'production',
                    BUILD_ID,
                    DEPLOY_KEY_HASH,
                    // The plugin's own Durable Object, under the binding
                    // name its manifest defaults to.
                    INTEGRATION_PROBE_SQL_STORE: createFakeDurableObjectNamespace((state) => {
                        return new IntegrationProbeSqlStoreCore({ ctx: state, env: {} });
                    }),
                },
            });

            used = await useProbe(booted.fetch, booted.origin, [ READ_TEST ]);

            for (const name of PLATFORM_CHECKS) {
                const response = await booted.fetch(`${ booted.origin }${ PLATFORM_CHECKS_PATHNAME }/${ name }`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${ DEPLOY_KEY }` },
                });

                platformChecks.push({ name, status: response.status, body: await response.json() });
            }
        });

        it('runs a probe test with the deploy key, refuses without it, and says what it is', () => {
            assertProbe(used, 'cloudflare');
        });

        // One check on a KV binding, one inside the plugin's Durable
        // Object, and the one that compares the two environments.
        it('runs platform checks through the route, as the expectations say', () => {
            for (const { name, status, body } of platformChecks) {
                assertEqual(200, status, name);
                assertEqual(name, body.name);
                assertEqual('', comparePlatformObservation(name, body.observation).join('; '), name);
            }
        });
    });
}, TIMEOUT);
