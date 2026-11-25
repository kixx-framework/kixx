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

function buildRequest(buildId, attributes, { headers = {}, id = buildId, contentType } = {}) {
    return makeJsonRequest({
        type: 'Build',
        id,
        attributes,
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

async function assign(context, buildId, attributes) {
    return readDocument(await putBuild(context, buildRequest(buildId, attributes), new ServerResponse())).data;
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
            assertEqual('releaseId,assignedAt,assignmentId,code', Object.keys(data.attributes).join(','));
            assertEqual(releaseId, data.attributes.releaseId);
            assertEqual(pointer.assignmentId, data.attributes.assignmentId);
            assertEqual(pointer.assignedAt, data.attributes.assignedAt);
            assertEqual(null, data.attributes.code);
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

        it('rejects every attribute but releaseId, expectedAssignmentId, and reason', async () => {
            const { context, service, releaseId, buildId } = await setup();
            const extra = {
                sourceRevision: 'abc123',
                summary: 'A change',
                code: { revision: 'abc123', fingerprint: 'f'.repeat(64) },
                force: true,
                forceReason: 'Because',
                actor: { type: 'user', id: 'someone' },
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

    describe('GET /builds and /builds/:buildId', ({ it }) => {

        it('reports the same Build shape as PUT, with code null', async () => {
            const { context, releaseId, buildId } = await setup();
            const written = await assign(context, buildId, { releaseId, expectedAssignmentId: null });

            const read = readDocument(await getBuild(context, getRequest(buildId), new ServerResponse())).data;
            const listed = readDocument(await listBuilds(context, getRequest(buildId), new ServerResponse())).data;

            assertEqual(JSON.stringify(written), JSON.stringify(read));
            assertEqual(JSON.stringify(written), JSON.stringify(listed.find((build) => build.id === buildId)));
            assertEqual(null, read.attributes.code);
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
            assertEqual(null, latest.attributes.sourceRevision);
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
