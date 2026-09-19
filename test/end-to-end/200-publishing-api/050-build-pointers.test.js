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
let conflictPointerBefore;
let conflictPointerAfter;
let conflictActivationsBefore;
let conflictActivationsAfter;
let carryForwardResponse;
let carryForwardReadResponse;
let forwardResponse;
let rollbackResponse;
let coherentReadAfterRollback;
let noOpResponse;
let staleAfterRollbackResponse;
let activationsBeforeNoOp;
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
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, expectedAssignmentId: null }),
            'pre-stage a never-assigned build',
        );
        readBackResponse = await getBuild(publishingToken, buildId);

        conflictPointerBefore = await getBuild(publishingToken, buildId);
        conflictActivationsBefore = await listBuildActivations(publishingToken, buildId);
        restagingConflictResponse = await putBuild(publishingToken, buildId, { releaseId: releaseA.id, expectedAssignmentId: null });
        staleMatchResponse = await putBuild(publishingToken, buildId, { releaseId: releaseA.id, expectedAssignmentId: crypto.randomUUID() });
        conflictPointerAfter = await getBuild(publishingToken, buildId);
        conflictActivationsAfter = await listBuildActivations(publishingToken, buildId);

        carryForwardResponse = mustSucceed(
            await putBuild(publishingToken, carryForwardBuildId, { releaseId: releaseA.id, expectedAssignmentId: null }),
            'carry the same Release forward to a second build id',
        );
        carryForwardReadResponse = await getBuild(publishingToken, carryForwardBuildId);

        forwardResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseB.id, expectedAssignmentId: readBackResponse.body.data.attributes.assignmentId, reason: 'publish' }),
            'publish forward to Release B',
        );

        rollbackResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, expectedAssignmentId: forwardResponse.body.data.attributes.assignmentId, reason: 'rollback' }),
            'roll back to Release A',
        );
        // Coherent reads: a read immediately following a successful assignment
        // must reflect that assignment, never the pointer it replaced.
        coherentReadAfterRollback = await getBuild(publishingToken, buildId);

        staleAfterRollbackResponse = await putBuild(publishingToken, buildId, {
            releaseId: releaseA.id,
            expectedAssignmentId: readBackResponse.body.data.attributes.assignmentId,
        });
        activationsBeforeNoOp = await listBuildActivations(publishingToken, buildId);
        noOpResponse = mustSucceed(
            await putBuild(publishingToken, buildId, { releaseId: releaseA.id, expectedAssignmentId: coherentReadAfterRollback.body.data.attributes.assignmentId }),
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
        assertEqual(`"${ readBackResponse.body.data.attributes.assignmentId }"`, readBackResponse.headers.get('etag'));
    });

    it('conflicts when explicit null targets an already-assigned build', () => {
        assertEqual(412, restagingConflictResponse.status);
        assertEqual('BuildPointerConflict', restagingConflictResponse.body.errors[0].code);
    });

    it('rejects a stale JSON identity', () => {
        assertEqual(412, staleMatchResponse.status);
        assertEqual('BuildPointerConflict', staleMatchResponse.body.errors[0].code);
    });

    it('preserves the pointer and activation history after same-target conflicts', () => {
        assertEqual(conflictPointerBefore.body.data.attributes.assignedAt, conflictPointerAfter.body.data.attributes.assignedAt);
        assertEqual(conflictActivationsBefore.body.data.length, conflictActivationsAfter.body.data.length);
    });

    it('carries one Release forward to a second build id with no manifest', () => {
        assertEqual(200, carryForwardResponse.status);
        assertEqual(releaseA.id, carryForwardReadResponse.body.data.attributes.releaseId);
    });

    it('publishes forward and rolls back using a JSON identity precondition', () => {
        assertEqual(200, forwardResponse.status);
        assertEqual(releaseB.id, forwardResponse.body.data.attributes.releaseId);
        assertEqual(200, rollbackResponse.status);
        assertEqual(releaseA.id, rollbackResponse.body.data.attributes.releaseId);
    });

    it('reads a coherent pointer immediately after an assignment', () => {
        assertEqual(200, coherentReadAfterRollback.status);
        assertEqual(releaseA.id, coherentReadAfterRollback.body.data.attributes.releaseId);
        assertEqual(`"${ coherentReadAfterRollback.body.data.attributes.assignmentId }"`, coherentReadAfterRollback.headers.get('etag'));
    });

    it('rejects the original A identity after A to B to A', () => {
        assertEqual(412, staleAfterRollbackResponse.status);
        const ids = [ preStageResponse, forwardResponse, rollbackResponse ].map((response) => response.body.data.attributes.assignmentId);
        assertEqual(3, new Set(ids).size);
    });

    it('treats reassigning the current Release as a success no-op', () => {
        assertEqual(200, noOpResponse.status);
        assertEqual(releaseA.id, noOpResponse.body.data.attributes.releaseId);
        assertEqual(rollbackResponse.body.data.attributes.assignedAt, noOpResponse.body.data.attributes.assignedAt);
        assertEqual(rollbackResponse.body.data.attributes.assignmentId, noOpResponse.body.data.attributes.assignmentId);
        assertEqual(activationsBeforeNoOp.body.data.length, activations.body.data.length);
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
        const listed = buildsListResponse.body.data.find((resource) => resource.id === `${ RUN_PREFIX }-next`);
        assertEqual(noOpResponse.body.data.attributes.assignmentId, listed.attributes.assignmentId);
    });
}, { disabled: IS_DEVELOPMENT_TARGET });

function mustSucceed(response, label) {
    if (response.status !== 200) {
        throw new Error(`Expected to ${ label }, but got ${ response.status }: ${ JSON.stringify(response.body) }`);
    }
    return response;
}
