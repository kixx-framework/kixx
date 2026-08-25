import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import ContentSnapshot from '../../../../src/kixx/content-addressable-store/content-snapshot.js';
import DeveloperContentStore from '../../../../src/plugins/node-content-store/lib/developer-content-store.js';


function makeLogger() {
    return { createChild: () => ({ debug() {} }) };
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
        const index = new ContentAddressableIndex(await store.getIndex({}, null));
        const snapshot = new ContentSnapshot(store, index);

        const home = await snapshot.batchGetPageAssets({}, '/');
        const copyFields = await snapshot.batchGetPageAssets({}, '/admin/style-guide/copy-fields');

        assert(home.pageDataFiles.length > 0, 'expected root metadata');
        assert(home.template, 'expected root template');
        assert(home.includes, 'expected root includes');
        assert(copyFields.template, 'expected copy-fields template');
        assertMatches('style-guide-wrapper.html', copyFields.template.pathname);
    });

    it('rescans edits without recreating the store', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-store-'));
        try {
            await fsp.mkdir(path.join(root, 'pages'), { recursive: true });
            const filepath = path.join(root, 'pages/page.json');
            await fsp.writeFile(filepath, JSON.stringify({ title: 'First' }));
            const store = makeStore(root);
            const first = await store.getIndex({}, null);

            await fsp.writeFile(filepath, JSON.stringify({ title: 'Second version' }));
            const second = await store.getIndex({}, null);

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
            const index = new ContentAddressableIndex(await store.getIndex({}, null));
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
        const caught = await catchAsyncError(() => store.getIndex({}, null));

        assertEqual('OperationalError', caught.name);
        assertEqual(cause, caught.cause);
    });
});
