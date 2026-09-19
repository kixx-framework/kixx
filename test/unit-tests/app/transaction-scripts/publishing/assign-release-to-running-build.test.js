import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { assignReleaseToRunningBuild } from '../../../../../src/app/transaction-scripts/publishing/assign-release-to-running-build.js';
import { ConflictError } from '../../../../../src/kixx/errors/mod.js';


const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000001';

const RELEASES = {
    'release-old': { releaseId: 'release-old', createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'a' },
    'release-current': { releaseId: 'release-current', createdAt: '2026-08-15T00:00:00.000Z', createdBy: 'a' },
    'release-new': { releaseId: 'release-new', createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'a' },
};

function makeContext(options) {
    const {
        runningBuildId = 'build-1',
        pointerReleaseId = 'release-current',
        assignmentId = ASSIGNMENT_ID,
        currentReleaseExists = true,
        releases = RELEASES,
    } = options ?? {};

    const assignCalls = [];
    const appendCalls = [];
    const storeCalls = [];

    const releaseCollection = {
        async get(_context, releaseId) {
            const attributes = releases[releaseId];
            if (releaseId === 'release-current' && !currentReleaseExists) {
                return null;
            }
            return attributes ? { toObject: () => attributes } : null;
        },
    };
    const activations = {
        async append(_context, attributes) {
            appendCalls.push(attributes);
        },
    };
    const store = {
        async getBuildPointer(_context, buildId) {
            storeCalls.push(buildId);
            return pointerReleaseId ? { rootHash: pointerReleaseId, assignmentId } : null;
        },
        async assignRelease(_context, buildId, attributes) {
            assignCalls.push({ buildId, ...attributes });
            return {
                buildId,
                releaseId: attributes.releaseId,
                assignedAt: '2026-09-01T00:00:00.000Z',
                isChanged: true,
                previousReleaseId: pointerReleaseId,
            };
        },
    };

    return {
        runtime: { build: { id: runningBuildId } },
        assignCalls,
        appendCalls,
        storeCalls,
        getService: () => store,
        getCollection: (type) => (type === 'Activation' ? activations : releaseCollection),
    };
}

function catchAsyncError(fn) {
    return fn().then(
        () => null,
        (error) => error,
    );
}

describe('assignReleaseToRunningBuild', ({ it }) => {

    it('retains the submitted token when another writer wins after the initial read', async () => {
        const context = makeContext();
        const store = context.getService();
        const conflict = new ConflictError('intervening assignment', { code: 'BuildPointerConflict' });
        store.assignRelease = async (_context, _buildId, assignment) => {
            assertEqual(ASSIGNMENT_ID, assignment.expectedAssignmentId);
            throw conflict;
        };

        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1', releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID, activatedBy: 'admin-1',
        }));

        assertEqual(conflict, error);
        assertEqual(0, context.appendCalls.length);
    });

    it('rejects a stale identity even when the same Release is current again', async () => {
        const context = makeContext({ assignmentId: crypto.randomUUID() });
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1', releaseId: 'release-current',
            expectedAssignmentId: ASSIGNMENT_ID, activatedBy: 'admin-1',
        }));

        assertEqual('BuildPointerConflict', error.code);
        assertEqual(0, context.assignCalls.length);
        assertEqual(0, context.appendCalls.length);
    });

    it('records rollback for an older Release', async () => {
        const context = makeContext();
        await assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-old',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        });

        assertEqual('rollback', context.appendCalls[0].reason);
    });

    it('records publish for a newer Release', async () => {
        const context = makeContext();
        await assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        });

        assertEqual('publish', context.appendCalls[0].reason);
    });

    it('passes expectedAssignmentId as the captured token and activatedBy through', async () => {
        const context = makeContext();
        await assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        });

        assertEqual(ASSIGNMENT_ID, context.assignCalls[0].expectedAssignmentId);
        assertEqual('admin-1', context.appendCalls[0].activatedBy);
    });

    it('throws RunningBuildMismatch when buildId differs from the running build', async () => {
        const context = makeContext({ runningBuildId: 'build-2' });
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        }));

        assert(error);
        assertEqual('ConflictError', error.name);
        assertEqual('RunningBuildMismatch', error.code);
        assertEqual(0, context.storeCalls.length);
    });

    it('throws RunningBuildMismatch when there is no running build id', async () => {
        const context = makeContext({ runningBuildId: null });
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        }));

        assert(error);
        assertEqual('RunningBuildMismatch', error.code);
    });

    it('throws RunningBuildUnassigned when the running build has no pointer', async () => {
        const context = makeContext({ pointerReleaseId: null });
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        }));

        assert(error);
        assertEqual('ConflictError', error.name);
        assertEqual('RunningBuildUnassigned', error.code);
        assertEqual(0, context.assignCalls.length);
    });

    it('throws BuildPointerConflict when expectedAssignmentId is stale', async () => {
        const context = makeContext({ pointerReleaseId: 'release-new', assignmentId: crypto.randomUUID() });
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-old',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        }));

        assert(error);
        assertEqual('ConflictError', error.name);
        assertEqual('BuildPointerConflict', error.code);
        assertEqual(0, context.assignCalls.length);
    });

    it('throws ReleaseNotFound for an unknown Release id', async () => {
        const context = makeContext();
        const error = await catchAsyncError(() => assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-missing',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        }));

        assert(error);
        assertEqual('NotFoundError', error.name);
        assertEqual('ReleaseNotFound', error.code);
    });

    it('falls back to publish when the current Release audit record is missing', async () => {
        const context = makeContext({ currentReleaseExists: false });
        await assignReleaseToRunningBuild(context, {
            buildId: 'build-1',
            releaseId: 'release-old',
            expectedAssignmentId: ASSIGNMENT_ID,
            activatedBy: 'admin-1',
        });

        assertEqual('publish', context.appendCalls[0].reason);
    });
});
