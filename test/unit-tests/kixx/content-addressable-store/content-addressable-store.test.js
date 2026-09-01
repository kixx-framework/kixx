import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import ContentAddressableStore, { CONTENT_CONTRACT_VERSION } from '../../../../src/kixx/content-addressable-store/content-addressable-store.js';
import { CONTENT_CONTRACT_PATH } from '../../../../src/kixx/content-addressable-store/content-layout.js';
import ContentAddressableIndex from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';

function makeContentStore() {
    const blobs = new Map();
    const closures = new Map();
    const builds = new Map();
    const calls = [];
    let saveCount = 0;
    return {
        blobs,
        closures,
        builds,
        calls,
        get saveCount() {
            return saveCount;
        },
        async putFile(_context, _pathname, hash, payload) {
            calls.push('putFile');
            blobs.set(hash, payload);
            return typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength;
        },
        async statFiles(_context, hashes) {
            return hashes.map((hash) => {
                const payload = blobs.get(hash);
                if (payload === undefined) {
                    return null;
                }
                return { size: typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength };
            });
        },
        async getFiles(_context, _type, files) {
            return files.map(({ hash }) => blobs.get(hash) ?? null);
        },
        async getFile(_context, _type, _pathname, hash) {
            calls.push('getFile');
            return blobs.get(hash) ?? null;
        },
        async saveIndex(_context, rootHash, entries) {
            if (!closures.has(rootHash)) {
                saveCount += 1;
                closures.set(rootHash, entries);
            }
        },
        async getIndex(_context, rootHash) {
            return closures.get(rootHash) ?? null;
        },
        async getBuild(_context, buildId) {
            calls.push('getBuild');
            const rootHash = builds.get(buildId)?.rootHash;
            return rootHash ? { rootHash, entries: closures.get(rootHash) } : null;
        },
        async getBuildPointer(_context, buildId) {
            return builds.get(buildId) ?? null;
        },
        async listBuilds() {
            return [ ...builds ].map(([ buildId, pointer ]) => ({ buildId, ...pointer }));
        },
        async assignBuild(_context, buildId, assignment) {
            calls.push('assignBuild');
            if (!closures.has(assignment.rootHash)) {
                return 'missingClosure';
            }
            const current = builds.get(buildId)?.rootHash ?? null;
            if (assignment.expectedRootHash !== undefined && assignment.expectedRootHash !== current) {
                return 'conflict';
            }
            builds.set(buildId, { rootHash: assignment.rootHash, assignedAt: '2026-09-01T00:00:00.000Z' });
            return 'assigned';
        },
    };
}

function makeLogger() {
    const errors = [];
    const noop = () => {};
    const child = {
        debug: noop,
        info: noop,
        warn: noop,
        error(message, info) {
            errors.push({ message, info });
        },
    };
    return { logger: { createChild: () => child }, errors };
}

function makeStore() {
    const contentStore = makeContentStore();
    const store = new ContentAddressableStore();
    const { logger, errors } = makeLogger();
    store.initialize({ logger, contentStore });
    return { store, contentStore, errors };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function uploadJson(store, value) {
    return await store.putObject({}, JSON.stringify(value));
}

async function uploadText(store, value) {
    return await store.putObject({}, value);
}

describe('ContentAddressableStore', ({ describe, it }) => {
    describe('Release lifecycle', ({ it }) => {
        it('reports every missing object before persisting anything', async () => {
            const { store, contentStore } = makeStore();
            const caught = await catchAsyncError(() => store.createRelease({}, { staticAssets: {
                '/a': { objectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', size: 1 },
                '/b': { objectId: 'bbbbbbbbbbbbbbbbbbbbbbbbbb', size: 2 },
            } }));
            assertEqual('ValidationError', caught.name);
            assertEqual(2, caught.errors.length);
            assertEqual(0, contentStore.closures.size);
        });

        it('rejects a claimed size which differs from stored bytes', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const caught = await catchAsyncError(() => store.createRelease({}, {
                staticAssets: { '/a': { objectId: object.objectId, size: 99 } },
            }));
            assertEqual('ValidationError', caught.name);
            assertEqual(0, contentStore.closures.size);
        });

        it('rejects invalid template syntax and unresolved partials', async () => {
            const { store } = makeStore();
            const invalid = await uploadText(store, '{{# open }}');
            const unresolved = await uploadText(store, '{{> missing }}');
            const baseTemplates = await uploadJson(store, [
                { id: 'base.html', source: '{{> missing-base }}' },
            ]);
            const caught = await catchAsyncError(() => store.createRelease({}, {
                baseTemplates,
                pages: {
                    '/one': { templates: { 'page.html': invalid } },
                    '/two': { templates: { 'page.html': unresolved } },
                },
            }));
            assertEqual('ValidationError', caught.name);
            assertEqual(3, caught.errors.length);
        });

        it('accepts templates whose partials resolve', async () => {
            const { store } = makeStore();
            const globals = await uploadJson(store, [ { id: 'header', source: '<header></header>' } ]);
            const page = await uploadText(store, '{{> header }}');
            const result = await store.createRelease({}, {
                globalTemplatePartials: globals,
                pages: { '/': { templates: { 'page.html': page } } },
            });
            assertEqual(CONTENT_CONTRACT_VERSION, result.contractVersion);
        });

        it('validateRelease persists nothing', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const result = await store.validateRelease({}, { staticAssets: { '/a': object } });
            assert(result.releaseId);
            assertEqual(0, contentStore.closures.size);
            assertEqual(1, contentStore.blobs.size);
        });

        it('validateRelease persists nothing when validation fails', async () => {
            const { store, contentStore } = makeStore();
            const before = contentStore.blobs.size;
            const caught = await catchAsyncError(() => store.validateRelease({}, {
                staticAssets: { '/missing': { objectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', size: 1 } },
            }));

            assertEqual('ValidationError', caught.name);
            assertEqual(before, contentStore.blobs.size);
            assertEqual(0, contentStore.closures.size);
        });

        it('creates identical content idempotently and reads its manifest', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const manifest = { staticAssets: { '/a': object } };
            const first = await store.createRelease({}, manifest);
            const second = await store.createRelease({}, manifest);
            assertEqual(first.releaseId, second.releaseId);
            assertEqual(1, contentStore.saveCount);
            assertEqual(
                JSON.stringify(manifest),
                JSON.stringify(await store.getReleaseManifest({}, first.releaseId)),
            );
        });
    });

    describe('assignment', ({ it }) => {
        it('assigns to a non-running unassigned build and retries as a no-op', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } });
            const pointer = await store.assignRelease({}, 'future', { releaseId: release.releaseId, precondition: null });
            assertEqual(release.releaseId, pointer.releaseId);
            const count = contentStore.calls.filter((call) => call === 'assignBuild').length;
            await store.assignRelease({}, 'future', { releaseId: release.releaseId, precondition: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' });
            assertEqual(count, contentStore.calls.filter((call) => call === 'assignBuild').length);
        });

        it('translates missing Releases and stale pointers', async () => {
            const { store } = makeStore();
            const missing = await catchAsyncError(() => store.assignRelease({}, 'build', { releaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' }));
            assertEqual('ReleaseNotFound', missing.code);
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } });
            const conflict = await catchAsyncError(() => store.assignRelease({}, 'build', {
                releaseId: release.releaseId,
                precondition: 'bbbbbbbbbbbbbbbbbbbbbbbbbb',
            }));
            assertEqual('BuildPointerConflict', conflict.code);
        });
    });

    describe('serving a build', ({ it }) => {
        it('serves a snapshot for a build with a compatible Release', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } });
            await store.assignRelease({}, 'build-1', { releaseId: release.releaseId, precondition: null });

            const context = { runtime: { build: { id: 'build-1' } } };
            const snapshot = await store.openSnapshot(context);
            assert(snapshot);

            const getFileCalls = contentStore.calls.filter((call) => call === 'getFile').length;
            await store.openSnapshot(context);
            assertEqual(getFileCalls, contentStore.calls.filter((call) => call === 'getFile').length);
        });

        it('serves a snapshot without a contract check in developer mode', async () => {
            const { store, contentStore } = makeStore();

            // A developer-mode adapter resolves a build with scanned entries
            // but no persisted rootHash, and never writes a content-contract
            // entry — there is no immutable Release to check it against.
            const entries = {
                '/': [ 'tree', 'aaaaaaaaaaaaaaaaaaaaaaaaaa' ],
                '/a': [ 'blob', 'bbbbbbbbbbbbbbbbbbbbbbbbbb', 3, null ],
            };
            contentStore.getBuild = async () => ({ rootHash: null, entries });

            const context = { runtime: { build: { id: 'dev' } } };
            const snapshot = await store.openSnapshot(context);
            assert(snapshot);
            assertEqual(0, contentStore.calls.filter((call) => call === 'getFile').length);
        });

        it('reports 503 naming the build id when no Release is assigned', async () => {
            const { store, errors } = makeStore();
            const context = { runtime: { build: { id: 'ghost-build' } } };

            const first = await catchAsyncError(() => store.openSnapshot(context));
            assertEqual(503, first.httpStatusCode);
            assertEqual('BuildNotServable', first.code);
            assert(first.message.includes('ghost-build'));
            assertEqual(1, errors.length);

            await catchAsyncError(() => store.openSnapshot(context));
            assertEqual(1, errors.length);
        });

        it('reports 503 naming both versions when the Release contract is unsupported', async () => {
            const { store, contentStore, errors } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } });
            await store.assignRelease({}, 'build-1', { releaseId: release.releaseId, precondition: null });

            const index = new ContentAddressableIndex(contentStore.closures.get(release.releaseId));
            const contractHash = index.getNode(CONTENT_CONTRACT_PATH).hash;
            contentStore.blobs.set(contractHash, JSON.stringify({ version: 999 }));

            const context = { runtime: { build: { id: 'build-1' } } };
            const caught = await catchAsyncError(() => store.openSnapshot(context));
            assertEqual(503, caught.httpStatusCode);
            assertEqual('BuildNotServable', caught.code);
            assert(caught.message.includes(String(CONTENT_CONTRACT_VERSION)));
            assert(caught.message.includes('999'));
            assertEqual(1, errors.length);

            await catchAsyncError(() => store.openSnapshot(context));
            assertEqual(1, errors.length);
        });
    });

    it('writes an object without opening a build snapshot', async () => {
        const { store, contentStore } = makeStore();
        const result = await store.putObject({}, new ArrayBuffer(0));
        assertEqual(0, result.size);
        assertEqual(false, contentStore.calls.includes('getBuild'));
    });
});
