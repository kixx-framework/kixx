import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import ContentSnapshot from '../../../../src/kixx/content-addressable-store/content-snapshot.js';
import DeveloperContentStore from '../../../../src/plugins/node-content-store/lib/developer-content-store.js';


function makeLogger() {
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    return { ...logger, createChild: () => logger };
}

function makeStore(root, fileSystem) {
    return new DeveloperContentStore({
        logger: makeLogger(),
        pagesDirectory: path.join(root, 'pages'),
        templatesDirectory: path.join(root, 'templates'),
        staticAssetsDirectory: path.join(root, 'static-assets'),
        emailsDirectory: path.join(root, 'emails'),
        fileSystem,
    });
}

async function makeWorkspace(files) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-store-'));
    for (const [ relativePath, source ] of Object.entries(files)) {
        const filepath = path.join(root, relativePath);
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, source);
    }
    return root;
}

async function openSnapshot(store) {
    const { entries } = await store.getBuild({}, null);
    return new ContentSnapshot(store, new ContentAddressableIndex(entries), makeLogger());
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('DeveloperContentStore', ({ it }) => {
    it('serves repository pages through a real ContentSnapshot', async () => {
        const store = makeStore(path.resolve('src'));
        const { rootHash, entries } = await store.getBuild({}, null);
        assertEqual(null, rootHash);
        const index = new ContentAddressableIndex(entries);
        const snapshot = new ContentSnapshot(store, index, makeLogger());

        const home = await snapshot.batchGetPageAssets({}, '/');
        const copyFields = await snapshot.batchGetPageAssets({}, '/admin/style-guide/copy-fields');

        assert(home.pageDataFiles.length > 0, 'expected root metadata');
        assert(home.template, 'expected root template');
        assert(home.includes, 'expected root includes');
        assert(copyFields.template, 'expected copy-fields template');
        assertEqual('/pages/admin/style-guide/copy-fields/page.html', copyFields.template.pathname);
    });

    it('rescans edits without recreating the store', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-store-'));
        try {
            await fsp.mkdir(path.join(root, 'pages'), { recursive: true });
            const filepath = path.join(root, 'pages/page.json');
            await fsp.writeFile(filepath, JSON.stringify({ title: 'First' }));
            const store = makeStore(root);
            const first = await store.getBuild({}, null);

            await fsp.writeFile(filepath, JSON.stringify({ title: 'Second version' }));
            const second = await store.getBuild({}, null);

            assertEqual(false, JSON.stringify(first) === JSON.stringify(second));
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('preserves bulk-read alignment and enforces the cap', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-store-'));
        try {
            await fsp.mkdir(path.join(root, 'static-assets'), { recursive: true });
            await fsp.writeFile(path.join(root, 'static-assets/known.txt'), 'known');
            const store = makeStore(root);
            const { rootHash, entries } = await store.getBuild({}, null);
            assertEqual(null, rootHash);
            const index = new ContentAddressableIndex(entries);
            const known = index.getNode('/assets/known.txt');
            const results = await store.getFiles({}, 'text', [
                known,
                { pathname: '/assets/missing.txt', hash: 'ignored' },
            ]);
            const tooMany = Array.from({ length: 101 }, () => known);
            const caught = await catchAsyncError(() => store.getFiles({}, 'text', tooMany));

            assertEqual('known', results[0]);
            assertEqual(null, results[1]);
            assertEqual('AssertionError', caught.name);
            assertMatches('at most 100', caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('rejects unsupported reads and every write method', async () => {
        const store = makeStore(path.resolve('src'));
        const errors = await Promise.all([
            catchAsyncError(() => store.getFile({}, 'json', '/page.json', 'ignored')),
            catchAsyncError(() => store.putFile()),
            catchAsyncError(() => store.statFiles()),
            catchAsyncError(() => store.getBuildPointer()),
            catchAsyncError(() => store.listBuilds()),
            catchAsyncError(() => store.saveIndex()),
            catchAsyncError(() => store.assignBuild()),
        ]);

        for (const error of errors) {
            assertEqual('AssertionError', error.name);
        }
    });

    it('wraps non-ENOENT filesystem failures with their cause', async () => {
        const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        const fileSystem = {
            ...fsp,
            async readdir() {
                throw cause;
            },
        };
        const store = makeStore('/unreadable', fileSystem);
        const caught = await catchAsyncError(() => store.getBuild({}, null));

        assertEqual('OperationalError', caught.name);
        assertEqual(cause, caught.cause);
    });

    it('fails only the page which references a missing file', async () => {
        const cases = [
            [ 'template', { template: 'page.html' }, 'page.html' ],
            [ 'partial', { template: 'page.html', partials: [ { id: 'card.html', filename: 'card.html' } ] }, 'card.html' ],
            [ 'include', { template: 'page.html', includes: { body: { filename: 'body.html' } } }, 'body.html' ],
        ];

        for (const [ label, json, missingFilename ] of cases) {
            const files = {
                'pages/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/page.html': 'Home',
                'pages/sibling/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/sibling/page.html': 'Sibling',
                'pages/broken/page.json': JSON.stringify(json),
                'pages/broken/child/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/broken/child/page.html': 'Child',
            };
            if (missingFilename !== 'page.html') {
                files['pages/broken/page.html'] = 'Broken';
            }
            const root = await makeWorkspace(files);

            try {
                const snapshot = await openSnapshot(makeStore(root));

                const home = await snapshot.batchGetPageAssets({}, '/');
                const sibling = await snapshot.batchGetPageAssets({}, '/sibling');
                const child = await snapshot.batchGetPageAssets({}, '/broken/child');
                const caught = await catchAsyncError(() => snapshot.batchGetPageAssets({}, '/broken'));

                assertEqual('Home', home.template.text, label);
                assertEqual('Sibling', sibling.template.text, label);
                assertEqual('Child', child.template.text, label);
                assertEqual('OperationalError', caught.name, label);
                assertEqual('InvalidDeveloperPage', caught.code, label);
                assertEqual(500, caught.httpStatusCode, label);
                assertMatches('"/broken"', caught.message);
                assertMatches(path.join(root, 'pages/broken', missingFilename), caught.message);
                assertEqual('ValidationError', caught.cause.name, label);
            } finally {
                await fsp.rm(root, { recursive: true, force: true });
            }
        }
    });

    it('fails a page with malformed metadata and its descendants', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
            'pages/page.html': 'Home',
            'pages/broken/page.json': '{ nope',
            'pages/broken/page.html': 'Broken',
            'pages/broken/child/page.json': JSON.stringify({ template: 'page.html' }),
            'pages/broken/child/page.html': 'Child',
        });

        try {
            const snapshot = await openSnapshot(makeStore(root));

            const home = await snapshot.batchGetPageAssets({}, '/');
            const broken = await catchAsyncError(() => snapshot.batchGetPageAssets({}, '/broken'));
            const child = await catchAsyncError(() => snapshot.batchGetPageAssets({}, '/broken/child'));

            assertEqual('Home', home.template.text);
            for (const caught of [ broken, child ]) {
                assertEqual('InvalidDeveloperPage', caught.code);
                assertMatches('"/broken"', caught.message);
                assertMatches('malformed JSON', caught.message);
            }
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('serves a broken page once its missing file is added', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
        });

        try {
            const store = makeStore(root);
            const before = await catchAsyncError(async () => {
                const snapshot = await openSnapshot(store);
                await snapshot.batchGetPageAssets({}, '/');
            });

            await fsp.writeFile(path.join(root, 'pages/page.html'), 'Fixed');
            const page = await (await openSnapshot(store)).batchGetPageAssets({}, '/');

            assertEqual('InvalidDeveloperPage', before.code);
            assertEqual('Fixed', page.template.text);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });
});
