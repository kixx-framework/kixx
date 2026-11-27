import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createProbeClient } from '../../test-app/probe/probe-client.js';
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

    it('wires the plugin through the generated registries', () => {
        assert(project.nodeRegistry.plugins.has('integration-probe:./adapters/node/plugin.js'));
        assert(project.cloudflareRegistry.plugins.has('integration-probe:./adapters/cloudflare/plugin.js'));
        assertMatches('./plugins/integration-probe/routes.js', project.readFile('routes.generated.js'));
    });

    describe('in production on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let used;

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
        });

        after(async () => {
            await booted.close();
        });

        it('runs probe tests with the deploy key, refuses without it, and says what it is', () => {
            assertProbe(used, 'node');
        });

        it('keeps the server running', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });
    });

    // Nothing listens: the Worker is called directly. The write test isn't
    // run here: it waits a real second through the Workers scheduler, which
    // only Cloudflare has. The Cloudflare factories run every test against
    // fakes in test/test-app/integration-probe/.
    describe('in production as a Worker against fakes', ({ before, it }) => {
        let used;

        before(async () => {
            const booted = bootOnCloudflare(project, {
                env: { ENVIRONMENT: 'production', BUILD_ID, DEPLOY_KEY_HASH },
            });

            used = await useProbe(booted.fetch, booted.origin, [ READ_TEST ]);
        });

        it('runs a probe test with the deploy key, refuses without it, and says what it is', () => {
            assertProbe(used, 'cloudflare');
        });
    });
});
