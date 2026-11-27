import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import ContentAddressableStore, { CONTENT_CONTRACT_VERSION } from '../../../kixx/content-addressable-store/content-addressable-store.js';
import { BadRequestError, OperationalError } from '../../../kixx/errors/mod.js';
import {
    CONTENT_CONTRACT_PATH,
    getGlobalTemplatePartialsPath,
    getStaticAssetPath,
} from '../../../kixx/content-addressable-store/content-layout.js';
import { hashBlob } from '../../../kixx/content-addressable-store/addressing.js';
import ContentAddressableIndex from '../../../kixx/content-addressable-store/content-addressable-index.js';

const DEPLOY_KEY = Object.freeze({ type: 'deploy-key', id: 'test-key' });

// A double of the content store port, enough to serve the service's own
// logic. What an adapter must do is the conformance suite's job.
function makeContentStore() {
    const blobs = new Map();
    const closures = new Map();
    const builds = new Map();
    const releases = new Map();
    const activations = [];
    const calls = [];
    const received = [];
    let saveCount = 0;
    return {
        blobs,
        closures,
        builds,
        releases,
        activations,
        calls,
        // The arguments of each publishing call, without the context.
        received,
        get saveCount() {
            return saveCount;
        },
        async putFile(_context, _pathname, hash, payload) {
            calls.push('putFile');
            blobs.set(hash, payload);
            return typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength;
        },
        async statFiles(_context, hashes) {
            calls.push('statFiles');
            return hashes.map((hash) => {
                const payload = blobs.get(hash);
                if (payload === undefined) {
                    return null;
                }
                return { size: typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength };
            });
        },
        async getFiles(_context, _type, files) {
            calls.push('getFiles');
            return files.map(({ hash }) => blobs.get(hash) ?? null);
        },
        async getFile(_context, _type, _pathname, hash) {
            calls.push('getFile');
            return blobs.get(hash) ?? null;
        },
        async saveIndex(_context, rootHash, entries) {
            calls.push('saveIndex');
            if (!closures.has(rootHash)) {
                saveCount += 1;
                closures.set(rootHash, entries);
            }
        },
        async getIndex(_context, rootHash) {
            calls.push('getIndex');
            return closures.get(rootHash) ?? null;
        },
        async getBuild(_context, buildId) {
            calls.push('getBuild');
            const rootHash = builds.get(buildId)?.rootHash;
            return rootHash ? { rootHash, entries: closures.get(rootHash) } : null;
        },
        async getBuildPointer(_context, buildId) {
            calls.push('getBuildPointer');
            return builds.get(buildId) ?? null;
        },
        async listBuilds() {
            calls.push('listBuilds');
            return [ ...builds ].map(([ buildId, pointer ]) => ({ buildId, ...pointer }));
        },
        async recordRelease(_context, release) {
            calls.push('recordRelease');
            received.push({ method: 'recordRelease', args: [ release ] });
            if (!closures.has(release.releaseId)) {
                return { outcome: 'missingClosure' };
            }
            if (releases.has(release.releaseId)) {
                return { outcome: 'exists', record: releases.get(release.releaseId) };
            }
            const record = { ...release, createdAt: '2026-09-01T00:00:00.000Z' };
            releases.set(release.releaseId, record);
            return { outcome: 'created', record };
        },
        async getRelease(_context, releaseId) {
            calls.push('getRelease');
            received.push({ method: 'getRelease', args: [ releaseId ] });
            return releases.get(releaseId) ?? null;
        },
        async listReleases(_context, options) {
            calls.push('listReleases');
            received.push({ method: 'listReleases', args: [ options ] });
            return { items: [ ...releases.values() ].reverse(), cursor: null };
        },
        async listActivations(_context, options) {
            calls.push('listActivations');
            received.push({ method: 'listActivations', args: [ options ] });
            return { items: activations.toReversed(), cursor: null };
        },
        async assignBuild(_context, buildId, assignment) {
            calls.push('assignBuild');
            received.push({ method: 'assignBuild', args: [ buildId, assignment ] });
            if (!closures.has(assignment.rootHash)) {
                return { outcome: 'missingClosure' };
            }
            const current = builds.get(buildId) ?? null;
            if (assignment.expectedAssignmentId !== undefined && assignment.expectedAssignmentId !== (current?.assignmentId ?? null)) {
                return { outcome: 'conflict' };
            }
            if (current?.rootHash === assignment.rootHash) {
                current.liveSourceRevision = assignment.activation.sourceRevision ?? current.liveSourceRevision;
                return {
                    outcome: 'unchanged',
                    pointer: current,
                    previousRootHash: current.rootHash,
                };
            }
            const pointer = {
                rootHash: assignment.rootHash,
                assignedAt: '2026-09-01T00:00:00.000Z',
                assignmentId: crypto.randomUUID(),
                code: current?.code ?? assignment.code ?? null,
                liveSourceRevision: assignment.activation.sourceRevision,
            };
            builds.set(buildId, pointer);
            activations.push({
                buildId,
                assignmentId: pointer.assignmentId,
                fromReleaseId: current?.rootHash ?? null,
                toReleaseId: pointer.rootHash,
                activatedAt: pointer.assignedAt,
                ...assignment.activation,
            });
            return { outcome: 'assigned', pointer, previousRootHash: current?.rootHash ?? null };
        },
    };
}

function makeLogger() {
    const errors = [];
    const entries = [];
    const record = (level) => (message, info) => {
        entries.push({ level, message, info });
    };
    const child = {
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error(message, info) {
            entries.push({ level: 'error', message, info });
            errors.push({ message, info });
        },
        createChild: () => child,
    };
    return { logger: { createChild: () => child }, errors, entries };
}

function makeStore() {
    const contentStore = makeContentStore();
    const store = new ContentAddressableStore();
    const { logger, errors, entries } = makeLogger();
    store.initialize({ logger, contentStore });
    return { store, contentStore, errors, logEntries: entries };
}

// The arguments every createRelease() call needs.
function creation(fields) {
    return { createdBy: DEPLOY_KEY, ...fields };
}

// The arguments every assignRelease() call needs.
function assignment(fields) {
    return { reason: 'publish', actor: DEPLOY_KEY, ...fields };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

// A double of the content store port that fails on every call, to prove a
// read never reached the store.
function makeUnreachableContentStore() {
    const contentStore = {};

    for (const name of Object.keys(makeContentStore())) {
        contentStore[name] = () => {
            throw new Error(`the content store was called: ${ name }()`);
        };
    }

    return contentStore;
}

function makeStoreOver(contentStore) {
    const store = new ContentAddressableStore();
    store.initialize({ logger: makeLogger().logger, contentStore });
    return store;
}

function makeRequestContext(buildId) {
    return { runtime: { build: { id: buildId ?? 'build-1' } } };
}

// Supplied content holding one static asset and the global partials bundle,
// shaped as the SuppliedContent contract says.
async function makeSuppliedContent(label) {
    const asset = `body { content: "${ label }"; }`;
    const partials = JSON.stringify([{ id: 'byline', source: label }]);
    const assetHash = await hashBlob(asset);
    const partialsHash = await hashBlob(partials);
    const texts = new Map([ [ assetHash, asset ], [ partialsHash, partials ] ]);
    const calls = [];

    const entries = await ContentAddressableIndex.buildIndex([
        { pathname: getStaticAssetPath('/site.css'), hash: assetHash, size: asset.length },
        { pathname: getGlobalTemplatePartialsPath(), hash: partialsHash, size: partials.length },
    ]);

    return {
        label,
        assetHash,
        calls,
        index: new ContentAddressableIndex(entries),
        objects: {
            async getFile(_context, type, pathname, hash) {
                calls.push({ method: 'getFile', type, pathname, hash });
                const text = texts.get(hash);
                if (text === undefined) {
                    return null;
                }
                return type === 'stream' ? new Response(text).body : text;
            },
            async getFiles(_context, _type, files) {
                calls.push({ method: 'getFiles' });
                return files.map(({ hash }) => texts.get(hash) ?? null);
            },
        },
        getPageProblems: () => [],
        getBaseTemplateProblems: () => [],
    };
}

async function readByline(snapshot, context) {
    const bundle = await snapshot.getGlobalTemplatePartials(context);
    return bundle.json[0].source;
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
            } }, creation()));
            assertEqual('ValidationError', caught.name);
            assertEqual(2, caught.errors.length);
            assertEqual(0, contentStore.closures.size);
        });

        it('rejects a claimed size which differs from stored bytes', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const caught = await catchAsyncError(() => store.createRelease({}, {
                staticAssets: { '/a': { objectId: object.objectId, size: 99 } },
            }, creation()));
            assertEqual('ValidationError', caught.name);
            assertEqual(0, contentStore.closures.size);
        });

        it('validates and creates templates without compiling or resolving partials', async () => {
            const { store, contentStore } = makeStore();
            const invalid = await uploadText(store, '{{# open }}');
            const unresolved = await uploadText(store, '{{> missing }}');
            const bundle = await uploadJson(store, [
                { id: 'broken', source: '{{# open }}' },
                { id: 'unresolved', source: '{{> missing }}' },
            ]);
            const manifest = {
                globalTemplatePartials: bundle,
                baseTemplates: bundle,
                pages: {
                    '/one': { partials: bundle, templates: { 'page.html': invalid } },
                    '/two': { templates: { 'page.html': unresolved } },
                },
            };

            const validated = await store.validateRelease({}, manifest);
            assertEqual(0, contentStore.closures.size);
            const created = await store.createRelease({}, manifest, creation());
            assertEqual(validated.releaseId, created.releaseId);
            assertEqual(1, contentStore.closures.size);
        });

        it('does not read standalone template bodies during release preparation', async () => {
            const { store, contentStore } = makeStore();
            const template = await uploadText(store, '{{# open }}');
            const tracker = new MockTracker();
            const getFiles = tracker.method(contentStore, 'getFiles');
            const manifest = { pages: { '/': { templates: { 'page.html': template } } } };

            await store.validateRelease({}, manifest);
            await store.createRelease({}, manifest, creation());

            assertEqual(0, getFiles.mock.callCount());
            tracker.reset();
        });

        it('aggregates JSON and schema errors across batches before persisting', async () => {
            const { store, contentStore } = makeStore();
            const malformed = await uploadText(store, '{');
            const wrongShape = await uploadJson(store, []);
            const invalidBundle = await uploadJson(store, [ null ]);
            const pages = {};
            for (let index = 0; index < 101; index += 1) {
                pages[`/page-${ index }`] = { metadata: index === 100 ? wrongShape : malformed };
            }
            const manifest = { pages, globalTemplatePartials: invalidBundle };
            const blobCount = contentStore.blobs.size;

            for (const method of [ 'validateRelease', 'createRelease' ]) {
                const caught = await catchAsyncError(() => store[method]({}, manifest, creation()));
                assert(caught, 'expected validation to fail');
                assertEqual('ValidationError', caught.name);
                assertEqual(102, caught.errors.length);
                assert(caught.errors.some(({ source }) => source === '/pages/page-100/page.json'));
                assertEqual(0, contentStore.closures.size);
                assertEqual(blobCount, contentStore.blobs.size);
            }
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
            const first = await store.createRelease({}, manifest, creation());
            const second = await store.createRelease({}, manifest, creation());
            assertEqual(first.releaseId, second.releaseId);
            assertEqual(1, contentStore.saveCount);
            assertEqual(
                JSON.stringify(manifest),
                JSON.stringify(await store.getReleaseManifest({}, first.releaseId)),
            );
        });

        it('returns the stored Release record', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const manifest = { staticAssets: { '/a': object } };
            const validated = await store.validateRelease({}, manifest);
            const createdBy = { type: 'user', id: 'user-1', name: 'Ada' };
            const provenance = { sourceRevision: 'abc123', message: 'First publish' };

            const record = await store.createRelease({}, manifest, { createdBy, provenance });

            assertEqual(
                'contractVersion,createdAt,createdBy,objectCount,provenance,releaseId,totalBytes',
                Object.keys(record).sort().join(),
            );
            assertEqual(validated.releaseId, record.releaseId);
            assertEqual('2026-09-01T00:00:00.000Z', record.createdAt);
            assertEqual(JSON.stringify(createdBy), JSON.stringify(record.createdBy));
            assertEqual(1, record.objectCount);
            assertEqual(3, record.totalBytes);
            assertEqual(CONTENT_CONTRACT_VERSION, record.contractVersion);
            assertEqual(JSON.stringify(provenance), JSON.stringify(record.provenance));

            // The record is written last, after the closure it names.
            assertEqual('saveIndex,recordRelease', contentStore.calls.slice(-2).join());
            assertEqual(1, contentStore.releases.size);
        });

        it('records an actor without a name and empty provenance by default', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');

            const record = await store.createRelease({}, { staticAssets: { '/a': object } }, { createdBy: DEPLOY_KEY });

            assertEqual(null, record.createdBy.name);
            assertEqual('{}', JSON.stringify(record.provenance));
            const [ input ] = contentStore.received.find(({ method }) => method === 'recordRelease').args;
            assertEqual(
                'contractVersion,createdBy,objectCount,provenance,releaseId,totalBytes',
                Object.keys(input).sort().join(),
            );
        });

        // CONT-3: a repeated Release keeps its first record.
        it('preserves the first record when identical content is recreated', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const manifest = { staticAssets: { '/a': object } };
            const first = await store.createRelease({}, manifest, {
                createdBy: { type: 'user', id: 'user-1' },
                provenance: { sourceRevision: 'first' },
            });
            const putsAfterFirst = contentStore.calls.filter((call) => call === 'putFile').length;
            const savesAfterFirst = contentStore.calls.filter((call) => call === 'saveIndex').length;

            const second = await store.createRelease({}, manifest, {
                createdBy: { type: 'deploy-key', id: 'other-key' },
                provenance: { sourceRevision: 'second' },
            });

            assertEqual(JSON.stringify(first), JSON.stringify(second));
            assertEqual('user-1', second.createdBy.id);
            assertEqual('first', second.provenance.sourceRevision);
            assertEqual(1, contentStore.releases.size);

            // The generated objects and the closure are still written on each call.
            assertEqual(putsAfterFirst + 2, contentStore.calls.filter((call) => call === 'putFile').length);
            assertEqual(savesAfterFirst + 1, contentStore.calls.filter((call) => call === 'saveIndex').length);
            assertEqual(1, contentStore.saveCount);
        });

        it('rejects invalid provenance before reading or writing content', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const manifest = { staticAssets: { '/a': object } };
            const callCount = contentStore.calls.length;

            const unknown = await catchAsyncError(() => store.createRelease({}, manifest, creation({
                provenance: { branch: 'main', author: 'Ada' },
            })));
            assertEqual('ValidationError', unknown.name);
            assertEqual('provenance.branch,provenance.author', unknown.errors.map(({ source }) => source).join());

            const tooLong = await catchAsyncError(() => store.createRelease({}, manifest, creation({
                provenance: { message: 'm'.repeat(2001) },
            })));
            assertEqual('ValidationError', tooLong.name);
            assertEqual('provenance.message', tooLong.errors[0].source);

            const notAnObject = await catchAsyncError(() => store.createRelease({}, manifest, creation({
                provenance: null,
            })));
            assertEqual('ValidationError', notAnObject.name);

            assertEqual(callCount, contentStore.calls.length);
        });

        it('rejects a missing or malformed creator before reading or writing content', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const manifest = { staticAssets: { '/a': object } };
            const callCount = contentStore.calls.length;

            const badOptions = [
                undefined,
                {},
                { createdBy: 'token-1' },
                { createdBy: { type: 'robot', id: 'r2' } },
                { createdBy: { type: 'user', id: '' } },
                { createdBy: { type: 'user', id: 'user-1', nmae: 'Ada' } },
            ];

            for (const options of badOptions) {
                const caught = await catchAsyncError(() => store.createRelease({}, manifest, options));
                assertEqual('AssertionError', caught.name);
                assert(caught.message.startsWith('ContentAddressableStore#createRelease: options.createdBy'));
            }

            assertEqual(callCount, contentStore.calls.length);
        });

        it('asserts when the store reports no closure for the Release it just saved', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            contentStore.recordRelease = async () => ({ outcome: 'missingClosure' });

            const caught = await catchAsyncError(() => store.createRelease({}, { staticAssets: { '/a': object } }, creation()));

            assertEqual('AssertionError', caught.name);
        });

        it('lets a failed Release record write propagate', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const failure = new OperationalError('index unavailable');
            contentStore.recordRelease = async () => {
                throw failure;
            };

            const caught = await catchAsyncError(() => store.createRelease({}, { staticAssets: { '/a': object } }, creation()));

            assertEqual(failure, caught);
        });

        it('never logs who created a Release or its provenance', async () => {
            const { store, logEntries } = makeStore();
            const object = await uploadText(store, 'abc');

            await store.createRelease({}, { staticAssets: { '/a': object } }, {
                createdBy: { type: 'user', id: 'user-1', name: 'Private Name' },
                provenance: { message: 'Private message' },
            });

            const text = JSON.stringify(logEntries);
            assertEqual(false, text.includes('Private Name'));
            assertEqual(false, text.includes('Private message'));
            assertEqual(1, logEntries.filter(({ message }) => message.startsWith('create-release')).length);
        });
    });

    describe('history reads', ({ it }) => {
        it('gets a Release record, or null when none was recorded', async () => {
            const { store } = makeStore();
            const object = await uploadText(store, 'abc');
            const record = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());

            assertEqual(JSON.stringify(record), JSON.stringify(await store.getRelease({}, record.releaseId)));
            assertEqual(null, await store.getRelease({}, 'aaaaaaaaaaaaaaaaaaaaaaaaaa'));

            const caught = await catchAsyncError(() => store.getRelease({}, ''));
            assertEqual('AssertionError', caught.name);
        });

        it('passes Release paging through and returns the page', async () => {
            const { store, contentStore } = makeStore();
            const context = {};
            const options = { limit: 2, cursor: '7' };
            const items = [ { releaseId: 'b' }, { releaseId: 'a' } ];
            const received = [];
            contentStore.listReleases = async (...args) => {
                received.push(args);
                return { items, cursor: '5' };
            };

            const page = await store.listReleases(context, options);

            assertEqual(1, received.length);
            assertEqual(context, received[0][0]);
            assertEqual(options, received[0][1]);
            assertEqual('cursor,items', Object.keys(page).sort().join());
            assertEqual(items, page.items);
            assertEqual('5', page.cursor);
        });

        it('passes Activation paging and the build filter through and returns the page', async () => {
            const { store, contentStore } = makeStore();
            const options = { buildId: 'build-1', limit: 1, cursor: '3' };
            const items = [ { buildId: 'build-1' } ];
            const received = [];
            contentStore.listActivations = async (...args) => {
                received.push(args);
                return { items, cursor: null };
            };

            const page = await store.listActivations({}, options);
            await store.listActivations({});

            assertEqual(options, received[0][1]);
            assertEqual(undefined, received[1][1]);
            assertEqual('cursor,items', Object.keys(page).sort().join());
            assertEqual(items, page.items);
            assertEqual(null, page.cursor);
        });

        it('lets an invalid cursor error from the store propagate unchanged', async () => {
            const { store, contentStore } = makeStore();
            const failure = new BadRequestError('The cursor is invalid.', { code: 'InvalidCursor' });
            const reject = async () => {
                throw failure;
            };
            contentStore.listReleases = reject;
            contentStore.listActivations = reject;

            assertEqual(failure, await catchAsyncError(() => store.listReleases({}, { cursor: 'x' })));
            assertEqual(failure, await catchAsyncError(() => store.listActivations({}, { cursor: 'x' })));
        });
    });

    describe('assignment', ({ it }) => {
        it('assigns to a non-running unassigned build and retries as a no-op', async () => {
            const { store } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            const pointer = await store.assignRelease({}, 'future', assignment({ releaseId: release.releaseId, expectedAssignmentId: null }));
            assertEqual(release.releaseId, pointer.releaseId);
            const unchanged = await store.assignRelease({}, 'future', assignment({ releaseId: release.releaseId, expectedAssignmentId: pointer.assignmentId }));
            assertEqual(false, unchanged.isChanged);
            assertEqual(release.releaseId, unchanged.previousReleaseId);
        });

        it('rejects the removed precondition argument instead of writing unconditionally', async () => {
            const { store, contentStore } = makeStore();
            const caught = await catchAsyncError(() => store.assignRelease({}, 'build', assignment({
                releaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', precondition: null,
            })));
            assertEqual('AssertionError', caught.name);
            assertEqual(0, contentStore.calls.length);
        });

        it('translates missing Releases and stale pointers', async () => {
            const { store } = makeStore();
            const missing = await catchAsyncError(() => store.assignRelease({}, 'build', assignment({ releaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' })));
            assertEqual('ReleaseNotFound', missing.code);
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            const conflict = await catchAsyncError(() => store.assignRelease({}, 'build', assignment({
                releaseId: release.releaseId,
                expectedAssignmentId: crypto.randomUUID(),
            })));
            assertEqual('BuildPointerConflict', conflict.code);
        });

        it('uses the captured assignment result without reading the pointer again', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const first = await store.createRelease({}, { staticAssets: { '/first': object } }, creation());
            const second = await store.createRelease({}, { staticAssets: { '/second': object } }, creation());
            contentStore.assignBuild = async () => ({
                outcome: 'assigned',
                pointer: { rootHash: first.releaseId, assignedAt: '2020-01-01T00:00:00.000Z', assignmentId: '00000000-0000-4000-8000-000000000001', code: null, liveSourceRevision: null },
                previousRootHash: null,
            });
            contentStore.getBuildPointer = async () => {
                throw new Error(`later assignment to ${ second.releaseId }`);
            };

            const result = await store.assignRelease({}, 'build', assignment({ releaseId: first.releaseId }));

            assertEqual(first.releaseId, result.releaseId);
            assertEqual('2020-01-01T00:00:00.000Z', result.assignedAt);
            assertEqual(true, result.isChanged);
            assertEqual(null, result.previousReleaseId);
        });

        it('passes the Activation and code info to the store and returns the code', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            const code = { revision: 'rev-1', fingerprint: 'print-1' };

            const result = await store.assignRelease({}, 'build', {
                releaseId: release.releaseId,
                expectedAssignmentId: null,
                reason: 'rollback',
                actor: { type: 'user', id: 'user-1', name: 'Ada' },
                sourceRevision: 'abc123',
                summary: 'Fix the footer',
                forceReason: 'Emergency',
                code,
            });

            const [ buildId, sent ] = contentStore.received.find(({ method }) => method === 'assignBuild').args;
            assertEqual('build', buildId);
            assertEqual('activation,code,expectedAssignmentId,rootHash', Object.keys(sent).sort().join());
            assertEqual(release.releaseId, sent.rootHash);
            assertEqual(null, sent.expectedAssignmentId);
            assertEqual(JSON.stringify({
                reason: 'rollback',
                actor: { type: 'user', id: 'user-1', name: 'Ada' },
                sourceRevision: 'abc123',
                summary: 'Fix the footer',
                forceReason: 'Emergency',
            }), JSON.stringify(sent.activation));
            assertEqual(JSON.stringify(code), JSON.stringify(sent.code));

            assertEqual(
                'assignedAt,assignmentId,buildId,code,isChanged,liveSourceRevision,previousReleaseId,releaseId',
                Object.keys(result).sort().join(),
            );
            assertEqual(JSON.stringify(code), JSON.stringify(result.code));
            assertEqual('abc123', result.liveSourceRevision);
            assertEqual(true, result.isChanged);
        });

        it('sends absent optional fields as null and reports a build without code info', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());

            const result = await store.assignRelease({}, 'build', {
                releaseId: release.releaseId,
                reason: 'publish',
                actor: DEPLOY_KEY,
            });

            const [ , sent ] = contentStore.received.find(({ method }) => method === 'assignBuild').args;
            assertEqual(undefined, sent.expectedAssignmentId);
            assertEqual(JSON.stringify({
                reason: 'publish',
                actor: { type: 'deploy-key', id: 'test-key', name: null },
                sourceRevision: null,
                summary: null,
                forceReason: null,
            }), JSON.stringify(sent.activation));
            assertEqual(null, sent.code);
            assertEqual(null, result.code);
        });

        it('requires a reason and an actor, and rejects malformed history fields, before any store call', async () => {
            const { store, contentStore } = makeStore();
            const releaseId = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';

            const badAssignments = [
                { releaseId, actor: DEPLOY_KEY },
                { releaseId, reason: 'deploy', actor: DEPLOY_KEY },
                { releaseId, reason: 'publish' },
                { releaseId, reason: 'publish', actor: { type: 'user' } },
                { releaseId, reason: 'publish', actor: DEPLOY_KEY, summary: 's'.repeat(2001) },
                { releaseId, reason: 'publish', actor: DEPLOY_KEY, sourceRevision: '' },
                { releaseId, reason: 'publish', actor: DEPLOY_KEY, forceReson: 'typo' },
                { releaseId, reason: 'publish', actor: DEPLOY_KEY, code: { revision: 'rev-1' } },
            ];

            for (const fields of badAssignments) {
                const caught = await catchAsyncError(() => store.assignRelease({}, 'build', fields));
                assertEqual('AssertionError', caught.name);
                assert(caught.message.startsWith('ContentAddressableStore#assignRelease: assignment'));
            }

            assertEqual(0, contentStore.calls.length);
        });

        // CONT-5: a build's code info is set once.
        it('translates a code mismatch into a 409 conflict', async () => {
            const { store, contentStore } = makeStore();
            contentStore.assignBuild = async () => ({
                outcome: 'codeMismatch',
                code: { revision: 'rev-1', fingerprint: 'print-1' },
            });

            const caught = await catchAsyncError(() => store.assignRelease({}, 'build', assignment({
                releaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
                code: { revision: 'rev-2', fingerprint: 'print-2' },
            })));

            assertEqual('ConflictError', caught.name);
            assertEqual('BuildCodeMismatch', caught.code);
            assertEqual(409, caught.httpStatusCode);
        });

        // CONT-3: the pointer and its Activation are one write, so there is no
        // separate history failure to carry on from.
        it('lets a failed assignment propagate without logging it as carried on', async () => {
            const { store, contentStore, logEntries } = makeStore();
            const failure = new OperationalError('index unavailable');
            contentStore.assignBuild = async () => {
                throw failure;
            };

            const caught = await catchAsyncError(() => store.assignRelease({}, 'build', assignment({
                releaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
            })));

            assertEqual(failure, caught);
            assertEqual(0, logEntries.filter(({ level }) => level === 'error' || level === 'warn').length);
        });

        it('never logs the actor name, the summary, or the override reason', async () => {
            const { store, logEntries } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            logEntries.length = 0;

            await store.assignRelease({}, 'build', {
                releaseId: release.releaseId,
                reason: 'publish',
                actor: { type: 'user', id: 'user-1', name: 'Private Name' },
                summary: 'Private summary',
                forceReason: 'Private override',
            });

            const text = JSON.stringify(logEntries);
            assertEqual(1, logEntries.length);
            assertEqual(false, text.includes('Private'));
        });
    });

    it('pins content contract version 2', () => {
        assertEqual(2, CONTENT_CONTRACT_VERSION);
    });

    describe('serving a build', ({ it }) => {
        it('serves a snapshot for a build with a compatible Release', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            await store.assignRelease({}, 'build-1', assignment({ releaseId: release.releaseId, expectedAssignmentId: null }));

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
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            await store.assignRelease({}, 'build-1', assignment({ releaseId: release.releaseId, expectedAssignmentId: null }));

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

        it('refuses a Release recorded under contract 1', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            await store.assignRelease({}, 'build-1', assignment({ releaseId: release.releaseId, expectedAssignmentId: null }));

            const index = new ContentAddressableIndex(contentStore.closures.get(release.releaseId));
            const contractHash = index.getNode(CONTENT_CONTRACT_PATH).hash;
            contentStore.blobs.set(contractHash, JSON.stringify({ version: 1 }));

            const context = { runtime: { build: { id: 'build-1' } } };
            const caught = await catchAsyncError(() => store.openSnapshot(context));
            assertEqual(503, caught.httpStatusCode);
            assertEqual('BuildNotServable', caught.code);
            assert(caught.message.includes('content contract version 1,'));
            assert(caught.message.includes('supports version 2'));
        });
    });

    it('writes an object without opening a build snapshot', async () => {
        const { store, contentStore } = makeStore();
        const result = await store.putObject({}, new ArrayBuffer(0));
        assertEqual(0, result.size);
        assertEqual(false, contentStore.calls.includes('getBuild'));
    });

    // R10: one request can be served from supplied content in place of the
    // build's Release, and every read of that request sees the same content.
    describe('supplied content', ({ it }) => {
        it('serves a snapshot from content supplied for the request, without the store', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const supplied = await makeSuppliedContent('supplied');
            const context = makeRequestContext();

            store.supplyContent(context, supplied);
            const snapshot = await store.openSnapshot(context);

            assertEqual(supplied, snapshot.suppliedContent);
            assertEqual('supplied', await readByline(snapshot, context));
            assertEqual(supplied.assetHash, snapshot.statStaticAsset('/site.css').hash);

            const asset = await snapshot.getStaticAsset(context, '/site.css');
            assertEqual('body { content: "supplied"; }', await new Response(asset.stream).text());
        });

        it('serves supplied content to a build with no assigned Release', async () => {
            const { store, contentStore } = makeStore();
            const context = makeRequestContext('ghost-build');

            store.supplyContent(context, await makeSuppliedContent('supplied'));
            const snapshot = await store.openSnapshot(context);

            assertEqual('supplied', await readByline(snapshot, context));
            assertEqual(false, contentStore.calls.includes('getBuild'));
        });

        it('gives every request the registered supplier\'s answer', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const supplied = await makeSuppliedContent('from-supplier');
            const seen = [];

            store.setContentSupplier(async (context) => {
                seen.push(context);
                return supplied;
            });

            const first = makeRequestContext();
            const second = makeRequestContext();

            assertEqual('from-supplier', await readByline(await store.openSnapshot(first), first));
            assertEqual('from-supplier', await readByline(await store.openSnapshot(second), second));
            assertEqual(2, seen.length);
            assertEqual(first, seen[0]);
            assertEqual(second, seen[1]);
        });

        it('leaves a request on the Release when the supplier answers null', async () => {
            const { store, contentStore } = makeStore();
            const object = await uploadText(store, 'abc');
            const release = await store.createRelease({}, { staticAssets: { '/a': object } }, creation());
            await store.assignRelease({}, 'build-1', assignment({ releaseId: release.releaseId, expectedAssignmentId: null }));

            let supplierCalls = 0;
            store.setContentSupplier(async () => {
                supplierCalls += 1;
                return null;
            });

            const context = makeRequestContext();
            const snapshot = await store.openSnapshot(context);
            await store.openSnapshot(context);

            assertEqual(null, snapshot.suppliedContent);
            assertEqual(object.objectId, snapshot.statStaticAsset('/a').hash);
            assert(contentStore.calls.includes('getBuild'));
            assertEqual(1, supplierCalls, 'the "none" answer is remembered for the context');
        });

        it('lets content supplied for a request win over the supplier', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const fromSupplier = await makeSuppliedContent('from-supplier');
            let supplierCalls = 0;

            store.setContentSupplier(async () => {
                supplierCalls += 1;
                return fromSupplier;
            });

            const context = makeRequestContext();
            store.supplyContent(context, await makeSuppliedContent('for-request'));

            assertEqual('for-request', await readByline(await store.openSnapshot(context), context));
            assertEqual(0, supplierCalls);
        });

        it('gives two requests supplied different content their own', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const first = makeRequestContext();
            const second = makeRequestContext();

            store.supplyContent(first, await makeSuppliedContent('first'));
            store.supplyContent(second, await makeSuppliedContent('second'));

            assertEqual('first', await readByline(await store.openSnapshot(first), first));
            assertEqual('second', await readByline(await store.openSnapshot(second), second));
        });

        it('calls the supplier once per request however many snapshots it opens', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const supplied = await makeSuppliedContent('from-supplier');
            let supplierCalls = 0;

            store.setContentSupplier(async () => {
                supplierCalls += 1;
                return supplied;
            });

            const context = makeRequestContext();
            const [ first, second ] = await Promise.all([
                store.openSnapshot(context),
                store.openSnapshot(context),
            ]);
            const third = await store.openSnapshot(context);
            await store.getStaticAssetByHash(context, '/site.css', supplied.assetHash);

            assertEqual(1, supplierCalls);
            assertEqual(supplied, first.suppliedContent);
            assertEqual(supplied, second.suppliedContent);
            assertEqual(supplied, third.suppliedContent);
        });

        it('reads a fingerprinted asset from the supplied content', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            const supplied = await makeSuppliedContent('supplied');
            const context = makeRequestContext();

            store.supplyContent(context, supplied);
            const stream = await store.getStaticAssetByHash(context, '/site.css', supplied.assetHash);

            assertEqual('body { content: "supplied"; }', await new Response(stream).text());
            assertEqual(getStaticAssetPath('/site.css'), supplied.calls[0].pathname);
            assertEqual('stream', supplied.calls[0].type);
        });

        it('reads a fingerprinted asset from the store when the supplied content lacks the hash', async () => {
            const { store, contentStore } = makeStore();
            const stored = await hashBlob('stored bytes');
            contentStore.blobs.set(stored, new Response('stored bytes').body);
            const context = makeRequestContext();

            store.supplyContent(context, await makeSuppliedContent('supplied'));
            const stream = await store.getStaticAssetByHash(context, '/logo.png', stored);

            assertEqual('stored bytes', await new Response(stream).text());
        });

        it('rejects the read when the supplier rejects, and asks again for the next request', async () => {
            const { store, contentStore } = makeStore();
            const supplied = await makeSuppliedContent('recovered');
            let supplierCalls = 0;

            store.setContentSupplier(async () => {
                supplierCalls += 1;
                if (supplierCalls === 1) {
                    throw new Error('compile failed');
                }
                return supplied;
            });

            const context = makeRequestContext();
            const caught = await catchAsyncError(() => store.openSnapshot(context));

            assertEqual('compile failed', caught.message);
            assertEqual(false, contentStore.calls.includes('getBuild'), 'no Release is served in its place');

            // Nothing was remembered for the failed context either.
            const retried = await store.openSnapshot(context);
            const next = await store.openSnapshot(makeRequestContext());

            assertEqual(supplied, retried.suppliedContent);
            assertEqual(supplied, next.suppliedContent);
            assertEqual(3, supplierCalls);
        });

        it('rejects the read when the supplier answers malformed content', async () => {
            const store = makeStoreOver(makeUnreachableContentStore());
            store.setContentSupplier(async () => ({ index: {} }));

            const caught = await catchAsyncError(() => store.openSnapshot(makeRequestContext()));

            assertEqual('AssertionError', caught.name);
            assert(caught.message.includes('content supplier'));
        });

        it('refuses malformed supplied content', async () => {
            const { store } = makeStore();
            const valid = await makeSuppliedContent('supplied');
            const malformed = [
                null,
                'content',
                { ...valid, index: {} },
                { ...valid, objects: { getFile: valid.objects.getFile } },
                { ...valid, objects: null },
                { ...valid, getPageProblems: null },
                { ...valid, getBaseTemplateProblems: undefined },
            ];

            for (const suppliedContent of malformed) {
                const caught = await catchAsyncError(() => store.supplyContent({}, suppliedContent));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assert(caught.message.includes('supplyContent()'));
            }
        });

        it('refuses a context that is not an object', async () => {
            const { store } = makeStore();
            const valid = await makeSuppliedContent('supplied');

            const caught = await catchAsyncError(() => store.supplyContent(null, valid));

            assertEqual('AssertionError', caught.name);
            assert(caught.message.includes('context'));
        });

        it('refuses a second supplier until the first is cleared', async () => {
            const { store } = makeStore();
            const supplier = async () => null;

            store.setContentSupplier(supplier);
            const second = await catchAsyncError(() => store.setContentSupplier(async () => null));
            const notFunction = await catchAsyncError(() => store.setContentSupplier('supplier'));

            assertEqual('AssertionError', second.name);
            assert(second.message.includes('already registered'));
            assertEqual('AssertionError', notFunction.name);

            store.setContentSupplier(null);
            store.setContentSupplier(supplier);
        });

        it('leaves getCurrentBuild() on the real store', async () => {
            const { store, contentStore } = makeStore();
            store.setContentSupplier(async () => {
                throw new Error('the supplier was called');
            });

            assertEqual(null, await store.getCurrentBuild(makeRequestContext('ghost-build')));
            assert(contentStore.calls.length > 0);
        });
    });
});
