import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { describe, MockTracker } from 'kixx-test';

import assignRelease from '../../../lib/publishing/assign-release.js';
import {
    BuildNotFoundError,
    BuildPointerConflictError,
    ReleaseNotFoundError,
} from '../../../lib/publishing/publishing-api-error.js';

// Opaque to this tool, but shaped like the server's version-4 UUIDs.
const CURRENT_ASSIGNMENT_ID = '4a2f7b2e-6d1c-4f0a-9b83-1c5d7e9a0f21';
const OBSERVED_ASSIGNMENT_ID = '8f3c1d40-52ab-4e19-8d77-6b0e2a4c9153';

describe('assignRelease()', ({ it }) => {
    it('quotes the assignment identity observed on the build read', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker, {
            buildId: 'production',
            releaseId: 'old-release',
            assignmentId: CURRENT_ASSIGNMENT_ID,
        });

        await assignRelease({
            client,
            buildId: 'production',
            releaseId: 'new-release',
            reason: 'rollback',
        });

        const call = client.assignBuild.mock.getCall(0);
        assertEqual('production', call.arguments[0]);
        assertEqual('new-release', call.arguments[1]);
        assertEqual(CURRENT_ASSIGNMENT_ID, call.arguments[2].expectedAssignmentId);
        assertEqual('rollback', call.arguments[2].reason);
        tracker.reset();
    });

    it('never derives the precondition from the release id', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker, {
            buildId: 'production',
            releaseId: 'old-release',
            assignmentId: CURRENT_ASSIGNMENT_ID,
        });

        await assignRelease({
            client,
            buildId: 'production',
            releaseId: 'new-release',
        });

        const { expectedAssignmentId } = client.assignBuild.mock.getCall(0).arguments[2];
        assert(expectedAssignmentId !== 'old-release');
        assertEqual(CURRENT_ASSIGNMENT_ID, expectedAssignmentId);
        tracker.reset();
    });

    it('sends a null precondition when the build has never been assigned', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker);
        client.getBuild.mock.mockImplementation(async () => {
            throw makeApiError(BuildNotFoundError, 404);
        });

        const result = await assignRelease({
            client,
            buildId: 'new-build',
            releaseId: 'release-id',
            reason: 'carry-forward',
        });

        assertEqual('release-id', result.releaseId);
        assertEqual(1, client.getBuild.mock.callCount());
        assertEqual(1, client.assignBuild.mock.callCount());
        const call = client.assignBuild.mock.getCall(0);
        assertEqual('new-build', call.arguments[0]);
        assertEqual(null, call.arguments[2].expectedAssignmentId);
        assertEqual('carry-forward', call.arguments[2].reason);
        tracker.reset();
    });

    it('propagates a build read failure that is not a missing pointer', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker);
        client.getBuild.mock.mockImplementation(async () => {
            throw makeApiError(ReleaseNotFoundError, 404);
        });

        const caught = await catchAsyncError(() => assignRelease({
            client,
            buildId: 'production',
            releaseId: 'release-id',
        }));

        assertEqual('ReleaseNotFoundError', caught.name);
        assertEqual(0, client.assignBuild.mock.callCount());
        tracker.reset();
    });

    it('refuses an incompatible server before reading or writing', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker, undefined, {
            capabilities: { buildAssignmentProtocolVersion: undefined },
        });

        const caught = await catchAsyncError(() => assignRelease({
            client,
            buildId: 'production',
            releaseId: 'release-id',
        }));

        // A caller must be able to tell "nothing was attempted" from "the
        // assignment failed", so this is not a BuildPointerConflictError.
        assertEqual('UnsupportedServerError', caught.name);
        assertEqual(0, client.getBuild.mock.callCount());
        assertEqual(0, client.assignBuild.mock.callCount());
        tracker.reset();
    });

    it('treats assigning the current Release as ordinary success', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker, {
            buildId: 'production',
            releaseId: 'same-release',
            assignmentId: CURRENT_ASSIGNMENT_ID,
            assignedAt: '2026-09-01T00:00:00.000Z',
        });

        // The server preserves assignedAt and assignmentId and records no
        // Activation. The absent history entry is not a failure.
        const result = await assignRelease({
            client,
            buildId: 'production',
            releaseId: 'same-release',
        });

        assertEqual('same-release', result.releaseId);
        assertEqual(CURRENT_ASSIGNMENT_ID, result.assignmentId);
        assertEqual(1, client.assignBuild.mock.callCount());
        tracker.reset();
    });

    it('reports the observed pointer on a conflict without writing again', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker, {
            buildId: 'production',
            releaseId: 'old-release',
            assignmentId: CURRENT_ASSIGNMENT_ID,
        });
        client.assignBuild.mock.mockImplementation(async () => {
            throw makeApiError(BuildPointerConflictError, 412);
        });
        client.getBuild.mock.mockImplementation(async () => ({
            buildId: 'production',
            releaseId: 'someone-elses-release',
            assignmentId: OBSERVED_ASSIGNMENT_ID,
        }));

        const caught = await catchAsyncError(() => assignRelease({
            client,
            buildId: 'production',
            releaseId: 'new-release',
        }));

        assertEqual('BuildPointerConflictError', caught.name);
        assertEqual(412, caught.status);
        assertEqual('production', caught.buildId);
        assertEqual('new-release', caught.intendedReleaseId);
        assertEqual('someone-elses-release', caught.observedReleaseId);
        assertEqual(OBSERVED_ASSIGNMENT_ID, caught.observedAssignmentId);
        assertMatches('someone-elses-release', caught.message);
        assertMatches('was not retried', caught.message);
        assertMatches('reconcile', caught.message);

        // One write attempt, plus the diagnostic re-read of the pointer.
        assertEqual(1, client.assignBuild.mock.callCount());
        assertEqual(2, client.getBuild.mock.callCount());
        tracker.reset();
    });

    it('still reports a conflict when the diagnostic re-read fails', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker);
        let readCount = 0;
        client.getBuild.mock.mockImplementation(async () => {
            readCount += 1;
            if (readCount === 1) {
                return {
                    buildId: 'production',
                    releaseId: 'old-release',
                    assignmentId: CURRENT_ASSIGNMENT_ID,
                };
            }
            throw new Error('connection reset');
        });
        client.assignBuild.mock.mockImplementation(async () => {
            throw makeApiError(BuildPointerConflictError, 412);
        });

        const caught = await catchAsyncError(() => assignRelease({
            client,
            buildId: 'production',
            releaseId: 'new-release',
        }));

        assertEqual('BuildPointerConflictError', caught.name);
        assertEqual(null, caught.observedReleaseId);
        assertMatches('unavailable', caught.message);
        tracker.reset();
    });

    it('describes a lost first-assignment race as a build with no pointer', async () => {
        const tracker = new MockTracker();
        const client = makeClient(tracker);
        client.getBuild.mock.mockImplementation(async () => {
            throw makeApiError(BuildNotFoundError, 404);
        });
        client.assignBuild.mock.mockImplementation(async () => {
            throw makeApiError(BuildPointerConflictError, 412);
        });

        const caught = await catchAsyncError(() => assignRelease({
            client,
            buildId: 'new-build',
            releaseId: 'release-id',
        }));

        assertEqual(null, caught.expectedAssignmentId);
        assertMatches('no pointer at all', caught.message);
        tracker.reset();
    });
});

function makeClient(tracker, build, options) {
    const { capabilities } = options ?? {};
    const currentBuild = build ?? {
        buildId: 'production',
        releaseId: 'old-release',
        assignmentId: CURRENT_ASSIGNMENT_ID,
    };

    return {
        async discover() {
            return await Promise.resolve({
                runningBuildId: 'production',
                contentContractVersion: 1,
                addressingFormat: 4,
                buildAssignmentProtocolVersion: 2,
                limits: {
                    maxObjectBytes: 26_214_400,
                    maxObjectStatusIds: 100,
                    maxManifestEntries: 10_000,
                },
                ...capabilities,
            });
        },
        getBuild: tracker.fn(async () => currentBuild),
        assignBuild: tracker.fn(async (buildId, releaseId, assignOptions) => ({
            buildId,
            releaseId,
            assignedAt: currentBuild.assignedAt ?? '2026-09-20T00:00:00.000Z',
            assignmentId: releaseId === currentBuild.releaseId
                ? assignOptions.expectedAssignmentId
                : OBSERVED_ASSIGNMENT_ID,
        })),
    };
}

function makeApiError(ErrorClass, status) {
    return new ErrorClass('API failure', {
        status,
        errors: [],
        method: 'PUT',
        url: 'https://example.com/publishing-api/v1/builds/production',
        attempts: 1,
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    throw new Error('Expected an error');
}
