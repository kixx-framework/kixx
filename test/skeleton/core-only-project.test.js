import fs from 'node:fs';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import { publishContent } from '../../test-app/test/test-helpers/publish.js';
import {
    BUILD_ID,
    DEPLOY_KEY,
    DEPLOY_KEY_HASH,
    assembleAndLoad,
    bootOnCloudflare,
    bootOnNode,
    readContentFiles,
} from './assembled-project-boot.js';


// The href of the stylesheet link the base template writes with assetUrl.
const STYLESHEET_HREF = /<link rel="stylesheet" href="(\/assets\/[a-z0-9]+\/site\.css)">/;

const GENERATED_FILE_NAMES = [
    'cloudflare-durable-objects.generated.js',
    'cloudflare-registry.generated.js',
    'example.env.secrets',
    'node-registry.generated.js',
    'routes.generated.js',
];


async function fetchText(fetch, url) {
    const response = await fetch(url);

    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        text: await response.text(),
    };
}

// The pages and files every boot must serve, read through a fetch function.
async function fetchSite(fetch, origin) {
    const home = await fetchText(fetch, `${ origin }/`);
    const about = await fetchText(fetch, `${ origin }/about`);
    const robots = await fetchText(fetch, `${ origin }/robots.txt`);
    const unknown = await fetchText(fetch, `${ origin }/no-such-page`);
    const href = STYLESHEET_HREF.exec(home.text)?.[1];
    const stylesheet = href ? await fetchText(fetch, `${ origin }${ href }`) : null;

    return { home, about, robots, unknown, stylesheet };
}

function assertSite(project, { home, about, robots, unknown, stylesheet }) {
    assertEqual(200, home.status);
    assertEqual('text/html; charset=utf-8', home.contentType);
    assertMatches('<title>Welcome to Kixx</title>', home.text);
    assertMatches('<h1>Welcome to Kixx</h1>', home.text);

    assertEqual(200, about.status);
    assertMatches('<h1>About</h1>', about.text);

    assertEqual(200, robots.status);
    assertEqual(project.readFile('public/robots.txt'), robots.text);

    assert(stylesheet, 'the home page links no fingerprinted stylesheet');
    assertEqual(200, stylesheet.status);
    assertEqual('text/css; charset=utf-8', stylesheet.contentType);

    // The compiler bundles a stylesheet, so it is not served byte for byte.
    assertMatches('font-family: sans-serif', stylesheet.text);

    assertEqual(404, unknown.status);
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Assembling copies about 250 files, which a busy CI runner doesn't always
// do inside the default second. Every block here gets this much.
const TIMEOUT = { timeout: 5000 };


// CORE-2: a project with no plugins boots and serves pages, from a config
// that holds only the app name and the log level. The project is the
// skeleton and core, assembled once for this file.
describe('core-only project', ({ before, after, describe }) => {
    let project;

    before(async () => {
        project = await assembleAndLoad();
    });

    after(async () => {
        await project.remove();
    });

    describe('generated files', ({ before, it }) => {
        let rendered;

        before(async () => {
            rendered = await project.tooling.renderProjectFiles({
                fileSystem: project.createProjectFileSystem(project.directory),
            });
        });

        it('are the five the generator renders, byte for byte', () => {
            assertEqual(GENERATED_FILE_NAMES.join(','), [ ...rendered.keys() ].sort().join(','));

            for (const [ fileName, text ] of rendered) {
                assert(project.readFile(fileName) === text, `${ fileName } differs from what the generator renders`);
            }
        });

        it('name no plugin', () => {
            for (const registry of [ project.nodeRegistry, project.cloudflareRegistry ]) {
                assert(registry.plugins.size > 0);
                assertEqual('', [ ...registry.plugins.keys() ].filter((key) => !key.startsWith('kixx:')).join(','));
                assertEqual(0, registry.contentRoots.length);
            }

            for (const fileName of GENERATED_FILE_NAMES) {
                assertFalsy(project.readFile(fileName).includes('plugins/'), `${ fileName } names a plugin directory`);
            }
        });

        it('declare the deploy key hash as the only secret', () => {
            assertEqual(
                JSON.stringify({ required: [], optional: [], requiredOutsideDevelopment: [ 'DEPLOY_KEY_HASH' ] }),
                JSON.stringify(project.nodeRegistry.secrets),
            );
        });
    });

    // Runs first among the boots: the project has no data/ directory yet.
    describe('in development on the Node.js adapters, with an empty environment', ({ before, after, it }) => {
        let booted;
        let dataDirectoryBeforeUse;
        let site;
        let storesAfterUse;

        before(async () => {
            const dataDirectory = path.join(project.directory, 'data');

            // No DEPLOY_KEY_HASH, no BUILD_ID, no DATA_DIRECTORY.
            booted = await bootOnNode(project, { environment: 'development', env: {} });

            site = await fetchSite(fetch, booted.origin);
            dataDirectoryBeforeUse = fs.existsSync(dataDirectory);

            // Each store is created when it is first used. The Publishing
            // API is open in development with no hash.
            await booted.appContext.getService('KeyValueStore').put(booted.appContext, 'skeleton/first-use', 'used');
            const builds = await fetch(`${ booted.origin }/publishing-api/v1/builds`);
            await builds.arrayBuffer();

            storesAfterUse = {
                publishingApiStatus: builds.status,
                keyValueStore: fs.existsSync(path.join(dataDirectory, 'key-value-store.sqlite')),
                contentStore: fs.existsSync(path.join(dataDirectory, 'content-store')),
            };
        });

        after(async () => {
            await booted.close();
        });

        it('renders the pages, the public file, and the stylesheet from the working tree', () => {
            assertSite(project, site);
        });

        it('creates no store to render the working tree', () => {
            assertFalsy(dataDirectoryBeforeUse);
        });

        it('creates the stores under the project\'s data/ on first use (OP-C)', () => {
            assertEqual(200, storesAfterUse.publishingApiStatus);
            assert(storesAfterUse.keyValueStore, 'expected data/key-value-store.sqlite');
            assert(storesAfterUse.contentStore, 'expected data/content-store');
        });

        it('logs at the level the project\'s config names', () => {
            assertEqual('DEBUG', booted.appContext.config.env.LOGGER.level);
        });

        it('keeps the server running', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });
    });

    describe('in production on the Node.js adapters', ({ before, after, it }) => {
        let bootError;
        let booted;
        let files;
        let beforeRelease;
        let secondBeforeRelease;
        let listeningBeforeRelease;
        let firstPublish;
        let site;
        let secondPublish;
        let unauthorized;

        before(async () => {
            const env = {
                DATA_DIRECTORY: path.join(project.temporaryDirectory, 'production-data'),
                BUILD_ID,
            };

            bootError = await catchAsyncError(() => bootOnNode(project, { environment: 'production', env }));

            booted = await bootOnNode(project, {
                environment: 'production',
                env: { ...env, DEPLOY_KEY_HASH },
            });

            files = await readContentFiles(project);

            beforeRelease = await fetchText(fetch, `${ booted.origin }/`);
            secondBeforeRelease = await fetchText(fetch, `${ booted.origin }/about`);
            listeningBeforeRelease = booted.server.listening;

            const publishOptions = {
                baseUrl: booted.origin,
                deployKey: DEPLOY_KEY,
                files,
                pluginContentRoots: project.nodeRegistry.contentRoots,
                templateHelpers: project.nodeRegistry.templateHelpers,
            };

            unauthorized = await catchAsyncError(() => publishContent({ ...publishOptions, deployKey: null }));

            firstPublish = await publishContent(publishOptions);
            site = await fetchSite(fetch, booted.origin);

            // The same content again: a content-only publish to the build
            // the first one staged.
            secondPublish = await publishContent(publishOptions);
        });

        after(async () => {
            await booted.close();
        });

        it('fails to boot without DEPLOY_KEY_HASH, naming it', () => {
            assert(bootError, 'expected the boot to fail');
            assertMatches('DEPLOY_KEY_HASH', bootError.message);
        });

        it('answers 503 while the build has no Release, and stays up', () => {
            assertEqual(503, beforeRelease.status);
            assertEqual('BuildNotServable', JSON.parse(beforeRelease.text).errors[0].code);
            assertEqual(503, secondBeforeRelease.status);
            assert(listeningBeforeRelease);
        });

        it('refuses a publish without the deploy key', () => {
            assert(unauthorized, 'expected the publish to be refused');
            assertMatches('answered 401: DeployKeyRequired', unauthorized.message);
        });

        it('takes a first publish over HTTP as a pre-stage of the running build', () => {
            assertEqual('prestage', firstPublish.intent);
            assertEqual(BUILD_ID, firstPublish.buildId);
            assert(firstPublish.uploaded > 0);
        });

        it('renders the pages, the public file, and the stylesheet from the Release', () => {
            assertSite(project, site);
        });

        it('takes a second publish as a content-only publish, uploading nothing again', () => {
            assertEqual('publish', secondPublish.intent);
            assertEqual(firstPublish.releaseId, secondPublish.releaseId);
            assertEqual(firstPublish.assignmentId, secondPublish.assignmentId);
            assertEqual(0, secondPublish.uploaded);
        });

        it('never puts the deploy key in an error', () => {
            assertFalsy(unauthorized.message.includes('kxdk_'));
            assertFalsy(bootError.message.includes(DEPLOY_KEY_HASH));
        });

        it('keeps the server running', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });
    });

    // Unit coverage of the same project as a Worker, against fakes. Nothing
    // listens: the Worker is called directly, and the publish helper is
    // handed the Worker's fetch.
    describe('in production as a Worker against fakes', ({ before, it }) => {
        let beforeRelease;
        let published;
        let site;

        before(async () => {
            // No config value besides the skeleton's cloudflare-config.jsonc.
            const booted = bootOnCloudflare(project, {
                env: { ENVIRONMENT: 'production', BUILD_ID, DEPLOY_KEY_HASH },
            });

            beforeRelease = await fetchText(booted.fetch, `${ booted.origin }/`);

            published = await publishContent({
                baseUrl: booted.origin,
                deployKey: DEPLOY_KEY,
                files: await readContentFiles(project),
                pluginContentRoots: project.cloudflareRegistry.contentRoots,
                templateHelpers: project.cloudflareRegistry.templateHelpers,
                fetch: booted.fetch,
            });

            site = await fetchSite(booted.fetch, booted.origin);
        });

        it('answers 503 while the build has no Release', () => {
            assertEqual(503, beforeRelease.status);
            assertEqual('BuildNotServable', JSON.parse(beforeRelease.text).errors[0].code);
        });

        it('takes a publish through the Publishing API', () => {
            assertEqual('prestage', published.intent);
            assertEqual(BUILD_ID, published.buildId);
        });

        it('renders the pages, the public file, and the stylesheet from the Release', () => {
            assertSite(project, site);
        });
    });
}, TIMEOUT);
