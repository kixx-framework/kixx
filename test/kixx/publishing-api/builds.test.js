import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ServerResponse from '../../../kixx/http-router/server-response.js';
import { getBuild, listBuildActivations, listBuilds, putBuild } from '../../../kixx/publishing-api/builds.js';
import {
    ASSIGNMENT_ID,
    TEST_HASH,
    catchError,
    createTestRelease,
    makeGetRequest,
    makeHarness,
    makeJsonRequest,
    readDocument,
    removeHarnesses,
} from './publishing-api-harness.js';


const MISSING_RELEASE_ID = 'z'.repeat(26);
const DEPLOY_KEY_ACTOR = JSON.stringify({ type: 'deploy-key', id: TEST_HASH.slice(0, 12), name: 'Deploy key' });

const COMMIT = 'a'.repeat(40);
const NEXT_COMMIT = 'b'.repeat(40);
const FINGERPRINT = `kxfp1:${ '1'.repeat(64) }`;
const OTHER_FINGERPRINT = `kxfp1:${ '2'.repeat(64) }`;
const CODE = { revision: COMMIT, fingerprint: FINGERPRINT };

// A complete protocol 4 pre-stage. Most tests are about something else, so
// buildRequest() starts from it; `bare: true` sends the attributes as given.
const PRESTAGE = Object.freeze({ intent: 'prestage', sourceRevision: COMMIT, code: CODE });

function publishAttributes(attributes) {
    return { intent: 'publish', sourceRevision: NEXT_COMMIT, codeFingerprint: FINGERPRINT, ...attributes };
}

function buildRequest(buildId, attributes, { headers = {}, id = buildId, contentType, bare = false } = {}) {
    return makeJsonRequest({
        type: 'Build',
        id,
        attributes: bare ? attributes : { ...PRESTAGE, ...attributes },
        headers,
        contentType,
        pathnameParams: { buildId },
    });
}

function getRequest(buildId, queryParams = {}) {
    return makeGetRequest({ pathnameParams: { buildId }, queryParams });
}

// Writing a Release syncs its blobs to disk, which is slow, so every test
// shares one store with two Releases. Each test gets its own build id.
let sharedSetup = null;
let buildCount = 0;

async function setup() {
    sharedSetup ??= (async () => {
        const harness = await makeHarness();
        const release = await createTestRelease(harness.context, harness.service, 'first');
        const next = await createTestRelease(harness.context, harness.service, 'next');
        return { ...harness, releaseId: release.releaseId, nextReleaseId: next.releaseId };
    })();

    buildCount += 1;
    return { ...await sharedSetup, buildId: `build-${ buildCount }` };
}

async function assign(context, buildId, attributes, options) {
    return readDocument(await putBuild(context, buildRequest(buildId, attributes, options), new ServerResponse())).data;
}

async function putError(context, buildId, attributes, options) {
    return await catchError(() => putBuild(context, buildRequest(buildId, attributes, options), new ServerResponse()));
}

async function activations(context, buildId) {
    return readDocument(await listBuildActivations(context, getRequest(buildId), new ServerResponse())).data;
}


describe('Publishing API builds', ({ after, describe }) => {

    after(removeHarnesses);

    describe('PUT /builds/:buildId', ({ it }) => {

        it('assigns a first Release with an explicit null precondition', async () => {
            const { context, service, releaseId, buildId } = await setup();

            const response = await putBuild(
                context,
                buildRequest(buildId, { releaseId, expectedAssignmentId: null }),
                new ServerResponse(),
            );
            const { data } = readDocument(response);
            const pointer = await service.getBuildPointer(context, buildId);

            assertEqual(200, response.status);
            assertEqual('Build', data.type);
            assertEqual(buildId, data.id);
            assertEqual('releaseId,assignedAt,assignmentId,code,liveSourceRevision', Object.keys(data.attributes).join(','));
            assertEqual(releaseId, data.attributes.releaseId);
            assertEqual(pointer.assignmentId, data.attributes.assignmentId);
            assertEqual(pointer.assignedAt, data.attributes.assignedAt);
            assertEqual(JSON.stringify(CODE), JSON.stringify(data.attributes.code));
            assertEqual(COMMIT, data.attributes.liveSourceRevision);
            assertEqual(null, response.headers.get('etag'));
            assertEqual(false, response.body.includes(TEST_HASH));
        });

        it('requires a JSON precondition even when legacy headers are present', async () => {
            const { context, service, releaseId, buildId } = await setup();

            for (const headers of [ {}, { 'if-match': `"${ releaseId }"` }, { 'if-none-match': '*' } ]) {
                const error = await catchError(() => putBuild(context, buildRequest(buildId, { releaseId }, { headers }), new ServerResponse()));

                assertEqual(428, error.httpStatusCode);
                assertEqual('PreconditionRequired', error.code);
            }

            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('reports a malformed precondition as a field error before any write', async () => {
            const { context, service, releaseId, buildId } = await setup();

            for (const expectedAssignmentId of [ '', releaseId, 42, false, {}, [], ` ${ ASSIGNMENT_ID } ` ]) {
                const error = await catchError(() => putBuild(
                    context,
                    buildRequest(buildId, { releaseId, expectedAssignmentId }),
                    new ServerResponse(),
                ));

                assertEqual(422, error.httpStatusCode);
                assertEqual('InvalidBuildAssignment', error.code);
                assert(error.errors.some((item) => item.source === 'attributes.expectedAssignmentId'));
            }

            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('rejects either legacy header when a valid JSON precondition is present', async () => {
            const { context, service, releaseId, buildId } = await setup();

            for (const headers of [
                { 'if-match': `"${ ASSIGNMENT_ID }"` },
                { 'if-none-match': '*' },
                { 'if-match': '' },
                { 'if-none-match': '' },
                { 'if-match': 'bad', 'if-none-match': '*' },
            ]) {
                const error = await catchError(() => putBuild(
                    context,
                    buildRequest(buildId, { releaseId, expectedAssignmentId: null }, { headers }),
                    new ServerResponse(),
                ));

                assertEqual(400, error.httpStatusCode);
                assert(error.message.includes('JSON attributes.expectedAssignmentId'));
            }

            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('validates the resource id, Release id, and reason together', async () => {
            const { context, buildId } = await setup();

            const error = await catchError(() => putBuild(
                context,
                buildRequest(buildId, { releaseId: 'bad', reason: 'bad', expectedAssignmentId: null }, { id: 'different-build' }),
                new ServerResponse(),
            ));

            assertEqual('InvalidBuildAssignment', error.code);
            assertEqual(
                'data.id,attributes.releaseId,attributes.reason',
                error.errors.map((item) => item.source).join(','),
            );
        });

        it('rejects every attribute protocol 4 does not define', async () => {
            const { context, service, releaseId, buildId } = await setup();
            const extra = {
                actor: { type: 'user', id: 'someone' },
                precondition: null,
                forced: true,
                fingerprint: FINGERPRINT,
            };

            for (const [ name, value ] of Object.entries(extra)) {
                const error = await catchError(() => putBuild(
                    context,
                    buildRequest(buildId, { releaseId, expectedAssignmentId: null, [name]: value }),
                    new ServerResponse(),
                ));

                assertEqual(422, error.httpStatusCode, name);
                assertEqual('InvalidBuildAssignment', error.code);
                assertEqual(`attributes.${ name }`, error.errors[0].source);
            }

            const all = await catchError(() => putBuild(
                context,
                buildRequest(buildId, { releaseId, expectedAssignmentId: null, ...extra }),
                new ServerResponse(),
            ));
            assertEqual(Object.keys(extra).length, all.errors.length);
            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('answers 412 for a stale or null precondition, keeping the cause', async () => {
            const { context, releaseId, buildId } = await setup();
            await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            for (const expectedAssignmentId of [ null, ASSIGNMENT_ID ]) {
                const error = await catchError(() => putBuild(
                    context,
                    buildRequest(buildId, { releaseId, expectedAssignmentId }),
                    new ServerResponse(),
                ));

                assertEqual(412, error.httpStatusCode);
                assertEqual('BuildPointerConflict', error.code);
                assertEqual('BuildPointerConflict', error.cause.code);
            }
        });

        it('answers 404 ReleaseNotFound for a Release that does not exist', async () => {
            const { context, buildId } = await setup();

            const error = await catchError(() => putBuild(
                context,
                buildRequest(buildId, { releaseId: MISSING_RELEASE_ID, expectedAssignmentId: null }),
                new ServerResponse(),
            ));

            assertEqual(404, error.httpStatusCode);
            assertEqual('ReleaseNotFound', error.code);
        });

        it('keeps the timestamp and identity of a no-op assignment', async () => {
            const { context, releaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const again = await assign(context, buildId, { releaseId, expectedAssignmentId: first.attributes.assignmentId });

            assertEqual(JSON.stringify(first), JSON.stringify(again));
        });

        it('carries the identity in JSON alone, with no header validator', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const read = await getBuild(context, getRequest(buildId), new ServerResponse());
            assertEqual(null, read.headers.get('etag'));

            const expectedAssignmentId = readDocument(read).data.attributes.assignmentId;
            const written = await assign(context, buildId, { releaseId: nextReleaseId, expectedAssignmentId, reason: 'rollback' });

            assertEqual(nextReleaseId, written.attributes.releaseId);
            assert(written.attributes.assignmentId !== expectedAssignmentId);
        });

        it('rejects a body that is not a JSON:API Build', async () => {
            const { context, releaseId, buildId } = await setup();

            const error = await catchError(() => putBuild(
                context,
                buildRequest(buildId, { releaseId, expectedAssignmentId: null }, { contentType: 'text/plain' }),
                new ServerResponse(),
            ));

            assertEqual(415, error.httpStatusCode);
        });
    });

    describe('PUT /builds/:buildId protocol 4 gates', ({ it }) => {

        // Production unless a test says otherwise: the harness default.
        async function developmentSetup() {
            const { buildId } = await setup();
            const harness = await makeHarness({ environment: 'development' });
            const release = await createTestRelease(harness.context, harness.service, 'development gates');
            return { ...harness, releaseId: release.releaseId, buildId };
        }

        it('requires code and sourceRevision on a pre-stage outside development', async () => {
            const { context, service, releaseId, buildId } = await setup();

            const error = await putError(context, buildId, { intent: 'prestage', releaseId, expectedAssignmentId: null }, { bare: true });

            assertEqual(422, error.httpStatusCode);
            assertEqual('InvalidBuildAssignment', error.code);
            assertEqual('attributes.sourceRevision,attributes.code', error.errors.map((item) => item.source).join(','));
            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('requires sourceRevision and codeFingerprint on a content-only publish outside development', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const error = await putError(context, buildId, {
                intent: 'publish',
                releaseId: nextReleaseId,
                expectedAssignmentId: first.attributes.assignmentId,
            }, { bare: true });

            assertEqual(422, error.httpStatusCode);
            assertEqual('attributes.sourceRevision,attributes.codeFingerprint', error.errors.map((item) => item.source).join(','));
        });

        it('requires intent in every environment', async () => {
            const { context, releaseId, buildId } = await developmentSetup();

            const error = await putError(context, buildId, { releaseId, expectedAssignmentId: null }, { bare: true });

            assertEqual(422, error.httpStatusCode);
            assertEqual('attributes.intent', error.errors.map((item) => item.source).join(','));
        });

        it('requires nothing new in development', async () => {
            const { context, releaseId, buildId } = await developmentSetup();

            const staged = await assign(context, buildId, { intent: 'prestage', releaseId, expectedAssignmentId: null }, { bare: true });
            const published = await assign(context, buildId, {
                intent: 'publish',
                releaseId,
                expectedAssignmentId: staged.attributes.assignmentId,
            }, { bare: true });

            assertEqual(null, staged.attributes.code);
            assertEqual(staged.attributes.assignmentId, published.attributes.assignmentId);
        });

        it('answers 404 BuildNotFound for a content-only publish to an unassigned build', async () => {
            const { context, service, releaseId, buildId } = await setup();

            const error = await putError(context, buildId, publishAttributes({ releaseId, expectedAssignmentId: null }), { bare: true });

            assertEqual(404, error.httpStatusCode);
            assertEqual('BuildNotFound', error.code);
            assertEqual(null, await service.getBuildPointer(context, buildId));
        });

        it('answers 409 BuildCodeUnknown for a content-only publish to a build without code', async () => {
            const { context, service, releaseId, nextReleaseId, buildId } = await setup();
            // Only the store, or development, can leave a build without code.
            const first = await service.assignRelease(context, buildId, {
                releaseId,
                expectedAssignmentId: null,
                reason: 'publish',
                actor: { type: 'deploy-key', id: 'development', name: 'Deploy key' },
            });

            const error = await putError(context, buildId, publishAttributes({
                releaseId: nextReleaseId,
                expectedAssignmentId: first.assignmentId,
            }), { bare: true });

            assertEqual(409, error.httpStatusCode);
            assertEqual('BuildCodeUnknown', error.code);
            assertEqual(releaseId, (await service.getBuildPointer(context, buildId)).rootHash);
        });

        it('answers 409 CodeFingerprintMismatch, which force does not override', async () => {
            const { context, service, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            for (const extra of [ {}, { force: true, forceReason: 'Emergency.' } ]) {
                const error = await putError(context, buildId, publishAttributes({
                    releaseId: nextReleaseId,
                    expectedAssignmentId: first.attributes.assignmentId,
                    codeFingerprint: OTHER_FINGERPRINT,
                    ...extra,
                }), { bare: true });

                assertEqual(409, error.httpStatusCode);
                assertEqual('CodeFingerprintMismatch', error.code);
            }
            assertEqual(releaseId, (await service.getBuildPointer(context, buildId)).rootHash);
            assertEqual(1, (await activations(context, buildId)).length);
        });

        it('answers 409 BuildCodeMismatch for a pre-stage with other code', async () => {
            const { context, service, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const error = await putError(context, buildId, {
                releaseId: nextReleaseId,
                expectedAssignmentId: first.attributes.assignmentId,
                code: { revision: NEXT_COMMIT, fingerprint: OTHER_FINGERPRINT },
            });

            assertEqual(409, error.httpStatusCode);
            assertEqual('BuildCodeMismatch', error.code);
            assertEqual(releaseId, (await service.getBuildPointer(context, buildId)).rootHash);
        });

        it('publishes content with the matching fingerprint and records force, summary, and commit', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null, reason: 'carry-forward' });

            const published = await assign(context, buildId, publishAttributes({
                releaseId: nextReleaseId,
                expectedAssignmentId: first.attributes.assignmentId,
                summary: 'Updated the opening hours.',
                force: true,
                forceReason: 'Hotfix published from a branch behind production.',
            }), { bare: true });
            const [ latest ] = await activations(context, buildId);

            assertEqual(nextReleaseId, published.attributes.releaseId);
            assertEqual(JSON.stringify(CODE), JSON.stringify(published.attributes.code));
            assertEqual(NEXT_COMMIT, latest.attributes.sourceRevision);
            assertEqual('Updated the opening hours.', latest.attributes.summary);
            assertEqual('Hotfix published from a branch behind production.', latest.attributes.forceReason);
        });

        it('answers 422, never 500, for every malformed attribute value', async () => {
            const { context, service, releaseId, buildId } = await setup();
            const cases = [
                [ 'intent', { intent: 'deploy' } ],
                [ 'sourceRevision', { sourceRevision: 'main' } ],
                [ 'summary', { summary: '' } ],
                [ 'summary', { summary: 's'.repeat(2001) } ],
                [ 'code', { code: 'abc' } ],
                [ 'code.revision', { code: { ...CODE, revision: 42 } } ],
                [ 'code.fingerprint', { code: { ...CODE, fingerprint: 'f'.repeat(64) } } ],
                [ 'code.branch', { code: { ...CODE, branch: 'main' } } ],
                [ 'codeFingerprint', { codeFingerprint: FINGERPRINT } ],
                [ 'force', { force: 'yes' } ],
                [ 'forceReason', { force: true } ],
                [ 'forceReason', { forceReason: 'Because.' } ],
                [ 'forceReason', { force: true, forceReason: 'r'.repeat(2001) } ],
            ];

            for (const [ source, attributes ] of cases) {
                const error = await putError(context, buildId, { releaseId, expectedAssignmentId: null, ...attributes });

                assertEqual(422, error.httpStatusCode, source);
                assertEqual('InvalidBuildAssignment', error.code);
                assertEqual(`attributes.${ source }`, error.errors.map((item) => item.source).join(','), source);
            }

            const onPublish = await putError(context, buildId, publishAttributes({
                releaseId,
                expectedAssignmentId: null,
                code: CODE,
                codeFingerprint: 'kxfp1:abc',
            }), { bare: true });
            assertEqual('attributes.code,attributes.codeFingerprint', onPublish.errors.map((item) => item.source).join(','));
            assertEqual(null, await service.getBuildPointer(context, buildId));
        });
    });

    describe('GET /builds and /builds/:buildId', ({ it }) => {

        it('reports the same Build shape from PUT, GET, and the list', async () => {
            const { context, releaseId, buildId } = await setup();
            const written = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const read = readDocument(await getBuild(context, getRequest(buildId), new ServerResponse())).data;
            const listed = readDocument(await listBuilds(context, getRequest(buildId), new ServerResponse())).data;

            assertEqual(JSON.stringify(written), JSON.stringify(read));
            assertEqual(JSON.stringify(written), JSON.stringify(listed.find((build) => build.id === buildId)));
            assertEqual(COMMIT, written.attributes.liveSourceRevision);
            assertEqual(JSON.stringify(CODE), JSON.stringify(read.attributes.code));
        });

        it('reports a newer commit that compiles to the live Release as liveSourceRevision', async () => {
            const { context, releaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const unchanged = await assign(context, buildId, publishAttributes({
                releaseId,
                expectedAssignmentId: first.attributes.assignmentId,
            }), { bare: true });
            const read = readDocument(await getBuild(context, getRequest(buildId), new ServerResponse())).data;

            assertEqual(first.attributes.assignmentId, unchanged.attributes.assignmentId);
            assertEqual(first.attributes.assignedAt, unchanged.attributes.assignedAt);
            assertEqual(NEXT_COMMIT, unchanged.attributes.liveSourceRevision);
            assertEqual(NEXT_COMMIT, read.attributes.liveSourceRevision);
            assertEqual(1, (await activations(context, buildId)).length);
        });

        it('answers a committed write without reading history', async () => {
            const { context, service, releaseId, buildId } = await setup();
            const listActivations = service.listActivations;
            service.listActivations = async () => {
                throw new Error('history is unavailable');
            };

            try {
                const written = await assign(context, buildId, { releaseId, expectedAssignmentId: null });
                assertEqual(COMMIT, written.attributes.liveSourceRevision);
            } finally {
                service.listActivations = listActivations;
            }
        });

        it('reports the newest Activation\'s commit as liveSourceRevision', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            const readLive = async () => readDocument(
                await getBuild(context, getRequest(buildId), new ServerResponse()),
            ).data.attributes.liveSourceRevision;

            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });
            assertEqual(COMMIT, await readLive());

            const second = await assign(context, buildId, publishAttributes({
                releaseId: nextReleaseId,
                expectedAssignmentId: first.attributes.assignmentId,
            }), { bare: true });
            assertEqual(NEXT_COMMIT, second.attributes.liveSourceRevision);
            assertEqual(NEXT_COMMIT, await readLive());
        });

        it('reports a null liveSourceRevision when the newest Activation has no commit', async () => {
            const { buildId } = await setup();
            const { context, service } = await makeHarness({ environment: 'development' });
            const release = await createTestRelease(context, service, 'development live');

            const written = await assign(context, buildId, { intent: 'prestage', releaseId: release.releaseId, expectedAssignmentId: null }, { bare: true });
            const read = readDocument(await getBuild(context, getRequest(buildId), new ServerResponse())).data;

            assertEqual(null, written.attributes.liveSourceRevision);
            assertEqual(null, read.attributes.liveSourceRevision);
        });

        it('answers 404 BuildNotFound for an unassigned build', async () => {
            const { context, buildId } = await setup();

            const error = await catchError(() => getBuild(context, getRequest(buildId), new ServerResponse()));

            assertEqual(404, error.httpStatusCode);
            assertEqual('BuildNotFound', error.code);
        });
    });

    describe('GET /builds/:buildId/activations', ({ it }) => {

        it('reports each Activation with the deploy key as actor, newest first', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });
            const second = await assign(context, buildId, {
                releaseId: nextReleaseId,
                expectedAssignmentId: first.attributes.assignmentId,
                reason: 'rollback',
            });

            const response = await listBuildActivations(context, getRequest(buildId), new ServerResponse());
            const { data, meta } = readDocument(response);
            const [ latest, earliest ] = data;

            assertEqual(2, data.length);
            assertEqual(null, meta.cursor);
            assertEqual('Activation', latest.type);
            assertEqual(`${ buildId }:${ second.attributes.assignmentId }`, latest.id);
            assertEqual(
                'buildId,assignmentId,fromReleaseId,toReleaseId,activatedAt,reason,actor,sourceRevision,summary,forceReason',
                Object.keys(latest.attributes).join(','),
            );
            assertEqual(releaseId, latest.attributes.fromReleaseId);
            assertEqual(nextReleaseId, latest.attributes.toReleaseId);
            assertEqual('rollback', latest.attributes.reason);
            assertEqual(DEPLOY_KEY_ACTOR, JSON.stringify(latest.attributes.actor));
            assertEqual(COMMIT, latest.attributes.sourceRevision);
            assertEqual(null, latest.attributes.summary);
            assertEqual(null, latest.attributes.forceReason);
            assertEqual(null, earliest.attributes.fromReleaseId);
            assertEqual('publish', earliest.attributes.reason);
            assertEqual(false, response.body.includes(TEST_HASH));
        });

        it('pages with the cursor', async () => {
            const { context, releaseId, nextReleaseId, buildId } = await setup();
            const first = await assign(context, buildId, { releaseId, expectedAssignmentId: null });
            await assign(context, buildId, { releaseId: nextReleaseId, expectedAssignmentId: first.attributes.assignmentId });

            const page1 = readDocument(await listBuildActivations(context, getRequest(buildId, { limit: '1' }), new ServerResponse()));
            const page2 = readDocument(await listBuildActivations(
                context,
                getRequest(buildId, { limit: '1', cursor: page1.meta.cursor }),
                new ServerResponse(),
            ));

            assertEqual(nextReleaseId, page1.data[0].attributes.toReleaseId);
            assertEqual(releaseId, page2.data[0].attributes.toReleaseId);
            assertEqual(null, page2.meta.cursor);
        });

        it('rejects bad pagination before reading the store', async () => {
            const { context, releaseId, buildId } = await setup();
            await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const empty = await catchError(() => listBuildActivations(context, getRequest(buildId, { cursor: '' }), new ServerResponse()));
            const garbage = await catchError(() => listBuildActivations(context, getRequest(buildId, { cursor: 'bad' }), new ServerResponse()));
            const zero = await catchError(() => listBuildActivations(context, getRequest(buildId, { limit: '0' }), new ServerResponse()));
            const tooMany = await catchError(() => listBuildActivations(context, getRequest(buildId, { limit: '101' }), new ServerResponse()));

            assertEqual(400, empty.httpStatusCode);
            assertEqual('InvalidCursor', empty.code);
            assertEqual(400, garbage.httpStatusCode);
            assertEqual('InvalidCursor', garbage.code);
            assertEqual(400, zero.httpStatusCode);
            assertEqual(400, tooMany.httpStatusCode);
        });

        it('answers 404 BuildNotFound for an unassigned build', async () => {
            const { context, buildId } = await setup();

            const error = await catchError(() => listBuildActivations(context, getRequest(buildId), new ServerResponse()));

            assertEqual(404, error.httpStatusCode);
            assertEqual('BuildNotFound', error.code);
        });
    });
});
