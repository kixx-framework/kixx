import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    compileContent,
    createMemoryContentSource,
    listContentDirectories,
    serializeContentObject,
} from '../../kixx/content-compiler/mod.js';
import { createFileSystemContentSource } from '../../kixx/adapters/node/content-compiler/lib/file-system-content-source.js';
import { parseJsonc } from '../../kixx/config/parse-jsonc.js';

import * as nodeRegistry from './project/node-registry.generated.js';
import {
    BUILD_ID,
    FIXTURE_DEPLOY_KEY,
    PROJECT_DIRECTORY,
    SECRET_VALUES,
    bootOnCloudflare,
    bootOnNode,
    readCommittedFile,
} from './fixture-project-boot.js';


// Who the tests publish as.
const PUBLISHER = Object.freeze({ type: 'deploy-key', id: 'fixture-key' });

const NEWS_PAGE = {
    'pages/news/page.json': JSON.stringify({ template: 'page.html', page: { title: 'News' } }),
    'pages/news/page.html': '<h1>News from the fixture</h1>\n',
};

// The href of the stylesheet link the base template writes with assetUrl.
const STYLESHEET_HREF = /<link rel="stylesheet" href="(\/assets\/([a-z0-9]+)\/site\.css)">/;


// Every content file of the committed fixture, by its path from the project
// root. Nothing is written back.
async function readFixtureContent() {
    const source = createFileSystemContentSource(PROJECT_DIRECTORY);
    const files = {};

    for (const directory of listContentDirectories(nodeRegistry.contentRoots)) {
        const { entries } = await source.listFiles(directory);

        for (const entry of entries) {
            const filepath = `${ directory }/${ entry.path }`;
            files[filepath] = new Uint8Array(await source.readFile(filepath));
        }
    }

    return files;
}

function compileFiles(files) {
    return compileContent({
        source: createMemoryContentSource(files),
        pluginContentRoots: nodeRegistry.contentRoots,
        templateHelpers: nodeRegistry.templateHelpers,
    });
}

// Publishes content to a booted fixture through its ContentAddressableStore
// service, as the Publishing API does: the objects, the Release, and its
// assignment to the build the fixture runs as.
async function publishRelease(appContext, files) {
    const store = appContext.getService('ContentAddressableStore');
    const compilation = await compileFiles(files);

    assert(compilation.release, 'expected the content to compile into a Release');

    for (const object of compilation.objects) {
        await store.putObject(appContext, serializeContentObject(object));
    }

    const release = await store.createRelease(appContext, compilation.release.manifest, { createdBy: PUBLISHER });

    await store.assignRelease(appContext, BUILD_ID, {
        releaseId: release.releaseId,
        reason: 'publish',
        actor: PUBLISHER,
    });

    return release;
}

async function fetchText(url, headers) {
    const response = await fetch(url, { headers });

    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        text: await response.text(),
    };
}

// Copies the fixture's config and content into a new directory a test may
// edit. The code still runs from the committed fixture.
async function copyFixture(changeConfig) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fixture-copy-'));
    const config = parseJsonc(readCommittedFile('node-config.jsonc'));

    changeConfig(config);

    await fsp.writeFile(path.join(directory, 'node-config.jsonc'), JSON.stringify(config));

    for (const [ filepath, bytes ] of Object.entries(await readFixtureContent())) {
        const target = path.join(directory, ...filepath.split('/'));

        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, bytes);
    }

    return directory;
}

// Records every key read or written through a key/value store service, by
// wrapping its get() and put(). Hyperview holds the same service object.
function recordKeyValueStoreKeys(keyValueStore) {
    const keys = [];
    const get = keyValueStore.get.bind(keyValueStore);
    const put = keyValueStore.put.bind(keyValueStore);

    keyValueStore.get = (context, key, ...rest) => {
        keys.push(key);
        return get(context, key, ...rest);
    };

    keyValueStore.put = (context, key, ...rest) => {
        keys.push(key);
        return put(context, key, ...rest);
    };

    return keys;
}


describe('fixture project: pages', ({ describe }) => {

    // CONT-13: the catch-all renders any page in the Release, so a new page
    // needs no route, no restart, and no code change.
    describe('a Release on the Node.js adapters', ({ before, after, it }) => {
        let booted;
        let files;
        let beforeRelease;
        let about;
        let pluginPage;
        let robots;
        let stylesheet;
        let newsBeforeSecondRelease;
        let newsAfterSecondRelease;
        let unknown;

        before(async () => {
            booted = await bootOnNode();
            files = await readFixtureContent();

            beforeRelease = await fetchText(`${ booted.origin }/about`);

            await publishRelease(booted.appContext, files);

            about = await fetchText(`${ booted.origin }/about`);
            pluginPage = await fetchText(`${ booted.origin }/visits/about`);
            robots = await fetchText(`${ booted.origin }/robots.txt`);
            stylesheet = await fetchText(`${ booted.origin }${ STYLESHEET_HREF.exec(about.text)?.[1] }`);
            newsBeforeSecondRelease = await fetchText(`${ booted.origin }/news`);
            unknown = await fetchText(`${ booted.origin }/no-such-page`);

            await publishRelease(booted.appContext, { ...files, ...NEWS_PAGE });

            newsAfterSecondRelease = await fetchText(`${ booted.origin }/news`);
        });

        after(async () => {
            await booted.close();
        });

        it('answers 503 while the build has no Release', () => {
            assertEqual(503, beforeRelease.status);
            assertEqual('BuildNotServable', JSON.parse(beforeRelease.text).errors[0].code);
        });

        it('renders a page of the assigned Release through the catch-all (CONT-13)', () => {
            assertEqual(200, about.status);
            assertEqual('text/html; charset=utf-8', about.contentType);
            assertMatches('<title>About</title>', about.text);
            assertMatches('<h1>About the fixture</h1>', about.text);

            // The project's global partial.
            assertMatches('<nav><a href="/">Home</a>', about.text);
        });

        it('renders a plugin\'s page through the same catch-all', () => {
            assertEqual(200, pluginPage.status);
            assertMatches('<p>The visits plugin counts visits.</p>', pluginPage.text);
        });

        it('serves a public file by its pathname and a stylesheet by its hash', () => {
            assertEqual(200, robots.status);
            assertEqual('User-agent: *\nDisallow:\n', robots.text);

            assertEqual(200, stylesheet.status);
            assertEqual('text/css; charset=utf-8', stylesheet.contentType);
            assertMatches('font-family: sans-serif', stylesheet.text);
        });

        it('answers 404 for a page the Release doesn\'t hold', () => {
            assertEqual(404, newsBeforeSecondRelease.status);
            assertEqual(404, unknown.status);
        });

        it('renders a new page once a Release that holds it is assigned, with no restart (CONT-13)', () => {
            assertEqual(200, newsAfterSecondRelease.status);
            assertMatches('<h1>News from the fixture</h1>', newsAfterSecondRelease.text);
        });
    });

    // CONT-11: a development server renders the working tree with no publish
    // step. The fixture's development config doesn't set
    // CONTENT_STORE.workingTree, so this is the default (OP-B).
    describe('the working tree in development', ({ before, after, it }) => {
        let booted;
        let compilation;
        let buildBeforePublish;
        let about;
        let pluginPage;
        let robots;
        let stylesheetHash;
        let stylesheet;
        let unknown;
        let release;
        let reportedBuild;
        let aboutAfterPublish;

        before(async () => {
            booted = await bootOnNode(nodeRegistry, { environment: 'development' });

            const files = await readFixtureContent();
            const store = booted.appContext.getService('ContentAddressableStore');

            compilation = await compileFiles(files);
            buildBeforePublish = await store.getCurrentBuild(booted.appContext);

            about = await fetchText(`${ booted.origin }/about`);
            pluginPage = await fetchText(`${ booted.origin }/visits/about`);
            robots = await fetchText(`${ booted.origin }/robots.txt`);
            unknown = await fetchText(`${ booted.origin }/no-such-page`);

            const [ , href, hash ] = STYLESHEET_HREF.exec(about.text) ?? [];

            stylesheetHash = hash;
            stylesheet = await fetchText(`${ booted.origin }${ href }`);

            // OP-C: a publish to a development server is stored and assigned.
            release = await publishRelease(booted.appContext, {
                ...files,
                'pages/about/page.html': '<h1>The published about page</h1>\n',
            });

            const response = await fetch(`${ booted.origin }/publishing-api/v1/builds/${ BUILD_ID }`, {
                headers: { authorization: `Bearer ${ FIXTURE_DEPLOY_KEY }` },
            });

            reportedBuild = { status: response.status, body: await response.json() };
            aboutAfterPublish = await fetchText(`${ booted.origin }/about`);
        });

        after(async () => {
            await booted.close();
        });

        it('renders a project page with no Release assigned (CONT-11)', () => {
            assertEqual(null, buildBeforePublish);
            assertEqual(200, about.status);
            assertEqual('text/html; charset=utf-8', about.contentType);
            assertMatches('<h1>About the fixture</h1>', about.text);
        });

        it('renders the visits plugin\'s page', () => {
            assertEqual(200, pluginPage.status);
            assertMatches('<p>The visits plugin counts visits.</p>', pluginPage.text);
        });

        it('serves a file under public/ by its pathname', () => {
            assertEqual(200, robots.status);
            assertEqual('User-agent: *\nDisallow:\n', robots.text);
        });

        it('serves the stylesheet at the fingerprinted URL the page links to, under the compiler\'s hash', () => {
            const object = compilation.objects.find(({ type, pathname }) => {
                return type === 'StaticAsset' && pathname === 'site.css';
            });

            assertEqual(object.hash, stylesheetHash);
            assertEqual(200, stylesheet.status);
            assertEqual('text/css; charset=utf-8', stylesheet.contentType);
            assertEqual('public, max-age=31536000, immutable', stylesheet.cacheControl);
            assertEqual(new TextDecoder().decode(serializeContentObject(object)), stylesheet.text);
        });

        it('answers 404 for a page the working tree doesn\'t hold', () => {
            assertEqual(404, unknown.status);
        });

        it('stores a published Release, which the Publishing API reports (OP-C)', () => {
            assertEqual(200, reportedBuild.status);
            assertMatches(release.releaseId, JSON.stringify(reportedBuild.body));
        });

        it('keeps showing the working tree after the publish (OP-C)', () => {
            assertEqual(200, aboutAfterPublish.status);
            assertMatches('<h1>About the fixture</h1>', aboutAfterPublish.text);
            assertFalsy(aboutAfterPublish.text.includes('The published about page'));
        });
    });

    // A copy of the fixture's config and content, so the test can edit it.
    // Its config turns the page cache on, which working-tree content must
    // ignore (R10).
    describe('an edited working tree in development', ({ before, after, it }) => {
        const ABOUT_TEMPLATE = [ 'pages', 'about', 'page.html' ];

        let projectDirectory;
        let booted;
        let keyValueStoreKeys;
        let original;
        let edited;
        let broken;
        let otherPageWhileBroken;
        let fixed;

        before(async () => {
            projectDirectory = await copyFixture((config) => {
                config.environments.development.HYPERVIEW = { usePageCache: true };
            });

            booted = await bootOnNode(nodeRegistry, { environment: 'development', baseDirectory: projectDirectory });

            keyValueStoreKeys = recordKeyValueStoreKeys(booted.appContext.getService('KeyValueStore'));

            const templateFile = path.join(projectDirectory, ...ABOUT_TEMPLATE);

            original = await fetchText(`${ booted.origin }/about`);

            // Rendered twice: a second render is what a page cache would serve.
            await fetchText(`${ booted.origin }/about`);

            await fsp.writeFile(templateFile, '<h1>About the fixture, edited</h1>\n');
            edited = await fetchText(`${ booted.origin }/about`);

            await fsp.writeFile(templateFile, '<h1>{{#if page.title}}An unclosed block</h1>\n');
            broken = await fetchText(`${ booted.origin }/about`);
            otherPageWhileBroken = await fetchText(`${ booted.origin }/visits/about`);

            await fsp.writeFile(templateFile, '<h1>About the fixture, fixed</h1>\n');
            fixed = await fetchText(`${ booted.origin }/about`);

            // A request that does use the key/value store, to show the
            // record works.
            await fetchText(`${ booted.origin }/visits`);
        });

        after(async () => {
            await booted.close();
            await fsp.rm(projectDirectory, { recursive: true, force: true });
        });

        it('renders the copy', () => {
            assertEqual(200, original.status);
            assertMatches('<h1>About the fixture</h1>', original.text);
        });

        it('shows an edit on the next request, with no restart (CONT-11)', () => {
            assertEqual(200, edited.status);
            assertMatches('<h1>About the fixture, edited</h1>', edited.text);
        });

        it('answers 500 with the page\'s problems for a page that fails the checks (OP-D)', () => {
            assertEqual(500, broken.status);
            assertEqual('text/html; charset=utf-8', broken.contentType);
            assertEqual('no-store', broken.cacheControl);
            assertMatches('/about', broken.text);
            assertMatches('pages/about/page.html', broken.text);
            assertMatches('template-syntax', broken.text);
        });

        it('keeps rendering the other pages meanwhile', () => {
            assertEqual(200, otherPageWhileBroken.status);
            assertMatches('<p>The visits plugin counts visits.</p>', otherPageWhileBroken.text);
        });

        it('renders the page again once it is fixed', () => {
            assertEqual(200, fixed.status);
            assertMatches('<h1>About the fixture, fixed</h1>', fixed.text);
        });

        it('keeps the server running through the failing page', () => {
            assert(booted.server.listening);
            assertEqual(0, booted.fakeProcess.exitCodes.length);
        });

        it('never reads or writes the page cache, though the config turns it on (R10)', () => {
            assert(booted.appContext.config.env.HYPERVIEW.usePageCache);
            assert(keyValueStoreKeys.includes('fixture/visits/count'), 'expected the record to see the visit count');
            assertEqual('', keyValueStoreKeys.filter((key) => key.startsWith('hyperview_page_cache#')).join());
        });
    });

    // Unit coverage of the same catch-all on the Cloudflare adapters, against
    // fakes. Nothing listens: the Worker is called directly.
    describe('a Release on the Cloudflare adapters against fakes', ({ before, it }) => {
        let beforeRelease;
        let about;
        let stylesheet;

        before(async () => {
            const booted = bootOnCloudflare({
                DEPLOY_KEY_HASH: SECRET_VALUES.DEPLOY_KEY_HASH,
                FIXTURE_APP_SECRET: SECRET_VALUES.FIXTURE_APP_SECRET,
                PANEL_SIGNING_SECRET: SECRET_VALUES.PANEL_SIGNING_SECRET,
            });

            beforeRelease = await booted.fetch('/about');

            await publishRelease(booted.appContext, await readFixtureContent());

            const response = await booted.fetch('/about');

            about = { status: response.status, text: await response.text() };
            stylesheet = await booted.fetch(STYLESHEET_HREF.exec(about.text)?.[1]);
        });

        it('answers 503 while the build has no Release', () => {
            assertEqual(503, beforeRelease.status);
        });

        it('renders a page of the assigned Release through the catch-all', () => {
            assertEqual(200, about.status);
            assertMatches('<h1>About the fixture</h1>', about.text);
        });

        it('serves the stylesheet the page links to', async () => {
            assertEqual(200, stylesheet.status);
            assertMatches('font-family: sans-serif', await stylesheet.text());
        });
    });
});
