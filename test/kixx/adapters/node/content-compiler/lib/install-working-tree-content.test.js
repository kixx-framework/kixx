import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableStore from '../../../../../../kixx/content-addressable-store/content-addressable-store.js';
import Logger from '../../../../../../kixx/logger/logger.js';
import { installWorkingTreeContent } from '../../../../../../kixx/adapters/node/content-compiler/lib/install-working-tree-content.js';


const REGISTRY = {
    contentRoots: [ { plugin: 'admin', pagesDirectory: 'plugins/admin/pages' } ],
    templateHelpers: [],
};

const PROJECT_FILES = {
    'pages/page.json': JSON.stringify({ template: 'page.html' }),
    'pages/page.html': '<main>Home</main>',
    'plugins/admin/pages/admin/page.json': JSON.stringify({ template: 'page.html' }),
    'plugins/admin/pages/admin/page.html': '<main>Admin</main>',
};

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

function makeLogger() {
    const logger = { debug() {}, info() {}, warn() {}, error() {}, createChild: () => logger };
    return logger;
}

// An application context over a real ContentAddressableStore whose content
// store port fails on any call: a read that reaches it didn't come from the
// working tree.
function makeAppContext(config) {
    const store = new ContentAddressableStore();
    const contentStoreCalls = [];

    store.initialize({
        logger: makeLogger(),
        contentStore: {
            async getBuild(_context, buildId) {
                contentStoreCalls.push(buildId);
                return null;
            },
        },
    });

    const requested = [];

    return {
        store,
        requested,
        contentStoreCalls,
        appContext: {
            config,
            // As boot leaves it: finalized, so it can make no child.
            logger: new Logger({ name: 'Test', level: 'NONE' }).finalize(),
            getService(name) {
                requested.push(name);
                return store;
            },
        },
    };
}

function makeRequestContext() {
    return { runtime: { build: { id: 'build-1' } }, logger: makeLogger() };
}

describe('node installWorkingTreeContent()', ({ before, after, it }) => {
    let projectDirectory;

    before(async () => {
        projectDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-install-working-tree-'));

        for (const [ relativePath, content ] of Object.entries(PROJECT_FILES)) {
            const filepath = path.join(projectDirectory, ...relativePath.split('/'));

            await fsp.mkdir(path.dirname(filepath), { recursive: true });
            await fsp.writeFile(filepath, content);
        }
    });

    after(async () => {
        await fsp.rm(projectDirectory, { recursive: true, force: true });
    });

    it('registers a supplier of the working tree in development', async () => {
        const { appContext, store, contentStoreCalls } = makeAppContext({ environment: 'development', env: {} });

        const installed = await installWorkingTreeContent({
            appContext,
            registry: REGISTRY,
            baseDirectory: projectDirectory,
        });

        assertEqual(true, installed);

        const context = makeRequestContext();
        const snapshot = await store.openSnapshot(context);
        const home = await snapshot.batchGetPageAssets(context, '/');
        const admin = await snapshot.batchGetPageAssets(context, '/admin');

        assert(snapshot.suppliedContent, 'expected a snapshot of supplied content');
        assertEqual('<main>Home</main>', home.template.text);
        assertEqual('<main>Admin</main>', admin.template.text);
        assertEqual(0, contentStoreCalls.length);
    });

    it('registers a supplier when the key is true in development', async () => {
        const { appContext, store } = makeAppContext({
            environment: 'development',
            env: { CONTENT_STORE: { workingTree: true } },
        });

        assertEqual(true, await installWorkingTreeContent({
            appContext,
            registry: REGISTRY,
            baseDirectory: projectDirectory,
        }));

        const snapshot = await store.openSnapshot(makeRequestContext());

        assert(snapshot.suppliedContent, 'expected a snapshot of supplied content');
    });

    it('registers nothing when the switch is off', async () => {
        const configs = [
            { environment: 'development', env: { CONTENT_STORE: { workingTree: false } } },
            { environment: 'production', env: {} },
        ];

        for (const config of configs) {
            const { appContext, store, requested, contentStoreCalls } = makeAppContext(config);

            // The registry isn't read: one without the exports is accepted.
            const installed = await installWorkingTreeContent({
                appContext,
                registry: {},
                baseDirectory: projectDirectory,
            });

            assertEqual(false, installed);
            assertEqual(0, requested.length);

            // With no supplier a request goes to the content store, which
            // holds no Release.
            const error = await catchRejection(store.openSnapshot(makeRequestContext()));

            assertEqual('BuildNotServable', error.code);
            assertEqual(1, contentStoreCalls.length);
        }
    });

    it('asserts clearly when the registry lacks contentRoots or templateHelpers', async () => {
        const cases = [
            [ { templateHelpers: [] }, 'contentRoots' ],
            [ { contentRoots: [] }, 'templateHelpers' ],
        ];

        for (const [ registry, expected ] of cases) {
            const { appContext, requested } = makeAppContext({ environment: 'development', env: {} });

            const error = await catchRejection(installWorkingTreeContent({
                appContext,
                registry,
                baseDirectory: projectDirectory,
            }));

            assert(error, 'expected a rejection');
            assertEqual('AssertionError', error.name);
            assertMatches(expected, error.message);
            assertMatches('Regenerate', error.message);
            assertEqual(0, requested.length);
        }
    });

    it('rejects, registering nothing, when a plugin content root is outside the project', async () => {
        const { appContext, requested } = makeAppContext({ environment: 'development', env: {} });

        const error = await catchRejection(installWorkingTreeContent({
            appContext,
            registry: { contentRoots: [ { plugin: 'unsafe', pagesDirectory: '../elsewhere' } ], templateHelpers: [] },
            baseDirectory: projectDirectory,
        }));

        assert(error, 'expected a rejection');
        assertEqual('ValidationError', error.name);
        assertEqual(0, requested.length);
    });

    it('rejects when the switch is refused', async () => {
        const { appContext } = makeAppContext({
            environment: 'production',
            env: { CONTENT_STORE: { workingTree: true } },
        });

        const error = await catchRejection(installWorkingTreeContent({
            appContext,
            registry: REGISTRY,
            baseDirectory: projectDirectory,
        }));

        assertEqual('OperationalError', error.name);
        assertMatches('CONTENT_STORE.workingTree', error.message);
    });
});
