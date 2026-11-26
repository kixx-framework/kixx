import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ServerResponse from '../../../kixx/http-router/server-response.js';
import {
    createRelease,
    getRelease,
    getReleaseManifest,
    listReleases,
    validateRelease,
} from '../../../kixx/publishing-api/releases.js';
import {
    TEST_HASH,
    catchError,
    makeGetRequest,
    makeHarness,
    makeJsonRequest,
    readDocument,
    removeHarnesses,
    uploadText,
} from './publishing-api-harness.js';


const MISSING_ID = 'z'.repeat(26);
const COMMIT = 'a'.repeat(40);

// The harness runs outside development, where CONT-4 requires a commit, so a
// request without provenance gets one. Pass `provenance` to send your own.
function releaseRequest(attributes, options = {}) {
    const withProvenance = Object.hasOwn(attributes, 'provenance')
        ? attributes
        : { provenance: { sourceRevision: COMMIT }, ...attributes };
    return makeJsonRequest({ type: 'Release', attributes: withProvenance, ...options });
}

// Writing to the store syncs blobs to disk, which is slow, so the tests share
// one store and one uploaded object. Each new Release names the object at its
// own pathname.
let sharedSetup = null;

async function setup() {
    sharedSetup ??= (async () => {
        const harness = await makeHarness();
        const object = await uploadText(harness.context, harness.service, 'body { color: red; }');
        return { ...harness, object };
    })();
    return await sharedSetup;
}

function manifestAt(object, pathname) {
    return { staticAssets: { [pathname]: object } };
}

function listRequest(queryParams) {
    return makeGetRequest({ queryParams });
}


describe('Publishing API Releases', ({ after, describe }) => {

    after(removeHarnesses);

    describe('POST /releases', ({ it }) => {

        it('creates a Release recorded as the deploy key, with its provenance', async () => {
            const { context, service, object } = await setup();
            const manifest = manifestAt(object, '/created.css');
            const provenance = { sourceRevision: COMMIT, message: 'First publish' };

            const response = await createRelease(context, releaseRequest({ manifest, provenance }), new ServerResponse());
            const { data } = readDocument(response);

            assertEqual(201, response.status);
            assertEqual('Release', data.type);
            assertEqual(
                'createdAt,createdBy,objectCount,totalBytes,contractVersion,provenance',
                Object.keys(data.attributes).join(','),
            );
            assertEqual(
                JSON.stringify({ type: 'deploy-key', id: TEST_HASH.slice(0, 12), name: 'Deploy key' }),
                JSON.stringify(data.attributes.createdBy),
            );
            assertEqual(JSON.stringify(provenance), JSON.stringify(data.attributes.provenance));
            assertEqual(2, data.attributes.contractVersion);
            assertEqual(1, data.attributes.objectCount);
            assertEqual(false, response.body.includes(TEST_HASH));

            const stored = await service.getRelease(context, data.id);
            assertEqual(data.attributes.createdAt, stored.createdAt);
        });

        it('records the development actor when no hash is set', async () => {
            const { context, object } = await setup();
            const development = { ...context, env: {}, config: { environment: 'development' } };
            const manifest = manifestAt(object, '/development.css');

            const response = await createRelease(development, releaseRequest({ manifest }), new ServerResponse());

            assertEqual('development', readDocument(response).data.attributes.createdBy.id);
        });

        it('rejects bad provenance as InvalidProvenance, before the manifest', async () => {
            const { context, service } = await setup();
            const before = (await service.listReleases(context)).items.length;
            const manifest = { staticAssets: 'wrong' };

            for (const provenance of [ null, 'text', { unknown: 'x' }, { sourceRevision: '' } ]) {
                const error = await catchError(() => createRelease(
                    context,
                    releaseRequest({ manifest, provenance }),
                    new ServerResponse(),
                ));

                assertEqual(422, error.httpStatusCode);
                assertEqual('InvalidProvenance', error.code);
                assert(error.errors.length > 0);
                assert(error.errors[0].source.startsWith('provenance'));
            }

            assertEqual(before, (await service.listReleases(context)).items.length);
        });

        it('requires a manifest', async () => {
            const { context } = await setup();

            const error = await catchError(() => createRelease(context, releaseRequest({}), new ServerResponse()));

            assertEqual(400, error.httpStatusCode);
        });

        it('turns malformed manifests into InvalidReleaseManifest', async () => {
            const { context } = await setup();

            for (const manifest of [
                { staticAssets: 'wrong' },
                { staticAssets: { '/site.txt': { content: 'hi', mediaType: 'text/plain' } } },
            ]) {
                for (const handler of [ createRelease, validateRelease ]) {
                    const error = await catchError(() => handler(context, releaseRequest({ manifest }), new ServerResponse()));

                    assertEqual('ValidationError', error.name);
                    assertEqual('InvalidReleaseManifest', error.code);
                    assertEqual(true, error.expected);
                }
            }
        });

        it('enforces the manifest entry limit on both operations (PERF-1)', async () => {
            const { context } = await setup();
            const manifest = {
                staticAssets: Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [
                    `/asset-${ index }.css`,
                    { objectId: 'a'.repeat(26), size: 0 },
                ])),
            };

            for (const handler of [ createRelease, validateRelease ]) {
                const error = await catchError(() => handler(context, releaseRequest({ manifest }), new ServerResponse()));

                assertEqual('BadRequestError', error.name);
                assertEqual(400, error.httpStatusCode);
            }
        });

        it('classifies missing stored objects as MissingContentObjects', async () => {
            const { context } = await setup();
            const manifest = { staticAssets: { '/site.css': { objectId: MISSING_ID, size: 1 } } };

            const error = await catchError(() => createRelease(context, releaseRequest({ manifest }), new ServerResponse()));

            assertEqual(422, error.httpStatusCode);
            assertEqual('MissingContentObjects', error.code);
            assertEqual('ValidationError', error.cause.name);
            assertEqual('/assets/site.css', error.errors[0].source);
        });

        it('classifies a size disagreement as ObjectSizeMismatch', async () => {
            const { context, object } = await setup();
            const manifest = { staticAssets: { '/site.css': { objectId: object.objectId, size: 99 } } };

            const error = await catchError(() => createRelease(context, releaseRequest({ manifest }), new ServerResponse()));

            assertEqual(409, error.httpStatusCode);
            assertEqual('ObjectSizeMismatch', error.code);
        });

        it('rejects a body that is not a JSON:API Release', async () => {
            const { context } = await setup();

            const wrongType = await catchError(() => createRelease(
                context,
                releaseRequest({ manifest: {} }, { contentType: 'application/json' }),
                new ServerResponse(),
            ));
            const mismatch = await catchError(() => createRelease(
                context,
                makeJsonRequest({ type: 'Build', attributes: { manifest: {} } }),
                new ServerResponse(),
            ));

            assertEqual(415, wrongType.httpStatusCode);
            assertEqual(409, mismatch.httpStatusCode);
            assertEqual('JsonApiResourceTypeMismatch', mismatch.code);
        });
    });

    describe('CONT-4: the Release names its commit', ({ it }) => {

        const operations = [ [ 'POST /releases', createRelease ], [ 'POST /releases/validation', validateRelease ] ];

        it('refuses a missing or non-commit sourceRevision outside development', async () => {
            const { context, object } = await setup();
            const manifest = manifestAt(object, '/cont-4.css');

            for (const [ name, operation ] of operations) {
                for (const provenance of [ {}, { message: 'No commit' }, { sourceRevision: 'main' }, { sourceRevision: 'A'.repeat(40) } ]) {
                    const error = await catchError(() => operation(context, releaseRequest({ manifest, provenance }), new ServerResponse()));

                    assertEqual(422, error?.httpStatusCode, name);
                    assertEqual('InvalidProvenance', error.code);
                    assertEqual('provenance.sourceRevision', error.errors.map((entry) => entry.source).join(','));
                }

                const missing = await catchError(() => operation(
                    context,
                    makeJsonRequest({ type: 'Release', attributes: { manifest } }),
                    new ServerResponse(),
                ));
                assertEqual('provenance.sourceRevision', missing.errors.map((entry) => entry.source).join(','), name);
            }
        });

        it('reports CONT-4 with the other provenance problems at once', async () => {
            const { context, object } = await setup();
            const manifest = manifestAt(object, '/cont-4.css');

            const error = await catchError(() => createRelease(
                context,
                releaseRequest({ manifest, provenance: { unknown: 'x' } }),
                new ServerResponse(),
            ));

            assertEqual('provenance.unknown,provenance.sourceRevision', error.errors.map((entry) => entry.source).join(','));
        });

        it('accepts a missing sourceRevision in development but refuses a malformed one', async () => {
            const { context, object } = await setup();
            const development = { ...context, config: { environment: 'development' } };
            const manifest = manifestAt(object, '/cont-4-development.css');

            for (const [ name, operation ] of operations) {
                const response = await operation(development, releaseRequest({ manifest, provenance: {} }), new ServerResponse());
                assert(response.status === 200 || response.status === 201, name);

                const error = await catchError(() => operation(
                    development,
                    releaseRequest({ manifest, provenance: { sourceRevision: 'main' } }),
                    new ServerResponse(),
                ));
                assertEqual('InvalidProvenance', error?.code, name);
                assertEqual('provenance.sourceRevision', error.errors.map((entry) => entry.source).join(','));
            }
        });

        it('accepts a SHA-256 commit id', async () => {
            const { context, object } = await setup();
            const manifest = manifestAt(object, '/cont-4-sha256.css');

            const response = await validateRelease(
                context,
                releaseRequest({ manifest, provenance: { sourceRevision: 'c'.repeat(64) } }),
                new ServerResponse(),
            );
            assertEqual(200, response.status);
        });
    });

    describe('POST /releases/validation', ({ it }) => {

        it('verifies a Release without recording it', async () => {
            const { context, service, object } = await setup();
            const manifest = manifestAt(object, '/validated.css');

            const response = await validateRelease(context, releaseRequest({ manifest }), new ServerResponse());
            const { data } = readDocument(response);

            assertEqual(200, response.status);
            assertEqual('ReleaseValidation', data.type);
            assertEqual(data.id, data.attributes.releaseId);
            assertEqual(null, await service.getRelease(context, data.id));
        });

        it('checks provenance too', async () => {
            const { context, object } = await setup();
            const manifest = manifestAt(object, '/validated.css');

            const error = await catchError(() => validateRelease(
                context,
                releaseRequest({ manifest, provenance: { unknown: 'x' } }),
                new ServerResponse(),
            ));

            assertEqual('InvalidProvenance', error.code);
        });
    });

    describe('GET /releases/:releaseId and its manifest', ({ it }) => {

        it('reads a Release and its manifest', async () => {
            const { context, service, object } = await setup();
            const release = await service.createRelease(context, manifestAt(object, '/read.css'), {
                createdBy: { type: 'deploy-key', id: 'test', name: null },
            });
            const request = makeGetRequest({ pathnameParams: { releaseId: release.releaseId } });

            const record = readDocument(await getRelease(context, request, new ServerResponse()));
            const manifest = readDocument(await getReleaseManifest(context, request, new ServerResponse()));

            assertEqual(release.releaseId, record.data.id);
            assertEqual(release.createdAt, record.data.attributes.createdAt);
            assertEqual('ReleaseManifest', manifest.data.type);
            assertEqual(release.releaseId, manifest.data.id);
            assert(manifest.data.attributes.manifest.staticAssets['/read.css']);
        });

        it('answers 404 ReleaseNotFound for an unknown or invalid id', async () => {
            const { context } = await setup();

            for (const releaseId of [ MISSING_ID, 'not-a-hash', '..' ]) {
                const request = makeGetRequest({ pathnameParams: { releaseId } });

                for (const handler of [ getRelease, getReleaseManifest ]) {
                    const error = await catchError(() => handler(context, request, new ServerResponse()));

                    assertEqual(404, error.httpStatusCode, releaseId);
                    assertEqual('ReleaseNotFound', error.code);
                }
            }
        });
    });

    describe('GET /releases', ({ it }) => {

        it('lists newest first and pages with the cursor', async () => {
            // A store of its own, so the list holds exactly these two.
            const { context, service } = await makeHarness();
            const object = await uploadText(context, service, 'listed');
            const createdBy = { type: 'deploy-key', id: 'test', name: null };
            const first = await service.createRelease(context, manifestAt(object, '/first.css'), { createdBy });
            const second = await service.createRelease(context, manifestAt(object, '/second.css'), { createdBy });

            const page1 = readDocument(await listReleases(context, listRequest({ limit: '1' }), new ServerResponse()));
            const page2 = readDocument(await listReleases(
                context,
                listRequest({ limit: '1', cursor: page1.meta.cursor }),
                new ServerResponse(),
            ));
            const all = readDocument(await listReleases(context, listRequest({}), new ServerResponse()));

            assertEqual(second.releaseId, page1.data[0].id);
            assertEqual(first.releaseId, page2.data[0].id);
            assertEqual(null, page2.meta.cursor);
            assertEqual(2, all.data.length);
            assertEqual('deploy-key', all.data[0].attributes.createdBy.type);
        });

        it('rejects an empty cursor as InvalidCursor, and a garbage cursor', async () => {
            const { context } = await setup();

            const empty = await catchError(() => listReleases(context, listRequest({ cursor: '' }), new ServerResponse()));
            const garbage = await catchError(() => listReleases(context, listRequest({ cursor: 'bad' }), new ServerResponse()));

            assertEqual(400, empty.httpStatusCode);
            assertEqual('InvalidCursor', empty.code);
            assertEqual(400, garbage.httpStatusCode);
            assertEqual('InvalidCursor', garbage.code);
        });

        it('rejects a limit outside 1 to 100, and repeated parameters', async () => {
            const { context } = await setup();

            for (const queryParams of [
                { limit: '0' },
                { limit: '101' },
                { limit: '1.5' },
                { limit: '' },
                { limit: [ '1', '2' ] },
                { cursor: [ 'a', 'b' ] },
            ]) {
                const error = await catchError(() => listReleases(context, listRequest(queryParams), new ServerResponse()));

                assertEqual(400, error.httpStatusCode, JSON.stringify(queryParams));
            }

            const response = await listReleases(context, listRequest({ limit: '100' }), new ServerResponse());
            assertEqual(200, response.status);
        });
    });
});
