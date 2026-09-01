import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import {
    createPublishingApiToken,
    createReleaseOrThrow,
    getBuild,
    listBuildActivations,
    listBuilds,
    putBuild,
    uploadObject,
} from '../test-helpers/publishing-workflows.js';
import { createRunPrefix, createRunScopedPathname } from './helpers.js';


const IS_DEVELOPMENT_TARGET = process.env.E2E_TESTS_TARGET === 'development';
const RUN_PREFIX = createRunPrefix();

// Every build id here is generated for this run, so none of them was ever
// assigned before this file executed and none needs restoring afterward —
// unlike the running build in 060-running-build.test.js, retained history
// for a synthetic build id is harmless (see the "What a run leaves behind"
// section of test/end-to-end/README.md).

let releaseA;
let releaseB;
let missingPreconditionResponse;
let unassignedReadResponse;
let preStageResponse;
let readBackResponse;
let restagingConflictResponse;
let staleMatchResponse;
let carryForwardResponse;
let carryForwardReadResponse;
let forwardResponse;
let rollbackResponse;
let coherentReadAfterRollback;
let noOpResponse;
let activations;
let buildsListResponse;


describe('Publishing API build-pointer workflows', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({ description: `${ RUN_PREFIX } build pointers` });
        const publishingToken = token.token;

        const objectA = await uploadObject(publishingToken, `${ RUN_PREFIX } release A content`);
        const objectB = await uploadObject(publishingToken, `${ RUN_PREFIX } release B content`);
        releaseA = await createReleaseOrThrow(publishingToken, {
            staticAssets: { [createRunScopedPathname(RUN_PREFIX, 'a.css')]: { objectId: objectA.objectId, size: objectA.size } },
        });
        releaseB = await createReleaseOrThrow(publishingToken, {
            staticAssets: { [createRunScopedPathname(RUN_PREFIX, 'b.css')]: { objectId: objectB.objectId, size: objectB.size } },
        });

        const buildId = `${ RUN_PREFIX }-next`;
        const carryForwardBuildId = `${ RUN_PREFIX }-carry`;

        missingPreconditionResponse = await putBuild(publishingToken, buildId, { releaseId: releaseA.id });
        unassignedReadResponse = await getBuild(publishingToken, buildId);

        preStageResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, ifNoneMatch: '*' }),
            'pre-stage a never-assigned build',
        );
        readBackResponse = await getBuild(publishingToken, buildId);

        restagingConflictResponse = await putBuild(publishingToken, buildId, { releaseId: releaseB.id, ifNoneMatch: '*' });
        staleMatchResponse = await putBuild(publishingToken, buildId, { releaseId: releaseB.id, ifMatch: releaseB.id });

        carryForwardResponse = mustSucceed(
            await putBuild(publishingToken, carryForwardBuildId, { releaseId: releaseA.id, ifNoneMatch: '*' }),
            'carry the same Release forward to a second build id',
        );
        carryForwardReadResponse = await getBuild(publishingToken, carryForwardBuildId);

        forwardResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseB.id, ifMatch: releaseA.id, reason: 'publish' }),
            'publish forward to Release B',
        );

        rollbackResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, ifMatch: releaseB.id, reason: 'rollback' }),
            'roll back to Release A',
        );
        // Coherent reads: a read immediately following a successful assignment
        // must reflect that assignment, never the pointer it replaced.
        coherentReadAfterRollback = await getBuild(publishingToken, buildId);

        noOpResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, ifMatch: releaseA.id }),
            'reassign the already-current Release',
        );

        activations = await listBuildActivations(publishingToken, buildId);
        buildsListResponse = await listBuilds(publishingToken);
    });

    it('rejects a pointer write with no precondition', () => {
        assertEqual(428, missingPreconditionResponse.status);
        assertEqual('PreconditionRequired', missingPreconditionResponse.body.errors[0].code);
    });

    it('reports 404 for a build nothing has ever pointed at', () => {
        assertEqual(404, unassignedReadResponse.status);
        assertEqual('BuildNotFound', unassignedReadResponse.body.errors[0].code);
    });

    it('pre-stages a never-assigned build and reads it back before any deploy', () => {
        assertEqual(200, preStageResponse.status);
        assertEqual(200, readBackResponse.status);
        assertEqual(releaseA.id, readBackResponse.body.data.attributes.releaseId);
        assertEqual(`"${ releaseA.id }"`, readBackResponse.headers.get('etag'));
    });

    it('conflicts when If-None-Match: * targets an already-assigned build', () => {
        assertEqual(412, restagingConflictResponse.status);
        assertEqual('BuildPointerConflict', restagingConflictResponse.body.errors[0].code);
    });

    it('rejects a stale If-Match precondition', () => {
        assertEqual(412, staleMatchResponse.status);
        assertEqual('BuildPointerConflict', staleMatchResponse.body.errors[0].code);
    });

    it('carries one Release forward to a second build id with no manifest', () => {
        assertEqual(200, carryForwardResponse.status);
        assertEqual(releaseA.id, carryForwardReadResponse.body.data.attributes.releaseId);
    });

    it('publishes forward and rolls back using an If-Match precondition', () => {
        assertEqual(200, forwardResponse.status);
        assertEqual(releaseB.id, forwardResponse.body.data.attributes.releaseId);
        assertEqual(200, rollbackResponse.status);
        assertEqual(releaseA.id, rollbackResponse.body.data.attributes.releaseId);
    });

    it('reads a coherent pointer immediately after an assignment', () => {
        assertEqual(200, coherentReadAfterRollback.status);
        assertEqual(releaseA.id, coherentReadAfterRollback.body.data.attributes.releaseId);
        assertEqual(`"${ releaseA.id }"`, coherentReadAfterRollback.headers.get('etag'));
    });

    it('treats reassigning the current Release as a success no-op', () => {
        assertEqual(200, noOpResponse.status);
        assertEqual(releaseA.id, noOpResponse.body.data.attributes.releaseId);
    });

    it('makes rollback discoverable purely from activation history, with no retained root hash', () => {
        assertEqual(200, activations.status);
        const reasons = activations.body.data.map((resource) => resource.attributes.reason);
        assert(reasons.includes('publish'));
        assert(reasons.includes('rollback'));

        const rollbackEntry = activations.body.data.find((resource) => resource.attributes.reason === 'rollback');
        assertEqual(releaseB.id, rollbackEntry.attributes.fromReleaseId);
        assertEqual(releaseA.id, rollbackEntry.attributes.toReleaseId);
    });

    it('lists every registered build pointer, including one nothing is running', () => {
        assertEqual(200, buildsListResponse.status);
        const ids = buildsListResponse.body.data.map((resource) => resource.id);
        assert(ids.includes(`${ RUN_PREFIX }-next`));
        assert(ids.includes(`${ RUN_PREFIX }-carry`));
    });
}, { disabled: IS_DEVELOPMENT_TARGET });

function mustSucceed(response, label) {
    if (response.status !== 200) {
        throw new Error(`Expected to ${ label }, but got ${ response.status }: ${ JSON.stringify(response.body) }`);
    }
    return response;
}
