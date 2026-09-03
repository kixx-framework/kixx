import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { ConflictError, NotFoundError } from '../../../kixx/errors/mod.js';
import { getRelease } from './get-release.js';
import { assignRelease } from './assign-release.js';


/**
 * Assigns an existing Release to the running build, inferring the audit
 * reason from Release timestamps.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Assignment arguments.
 * @param {string} args.buildId - Build pointer the caller expects to be running.
 * @param {string} args.releaseId - Release to assign.
 * @param {string} args.expectedReleaseId - Release the caller expects is currently assigned.
 * @param {string} args.activatedBy - Admin user id performing the assignment.
 * @returns {Promise<Object>} Authoritative resulting build pointer.
 * @throws {ConflictError} With code `RunningBuildMismatch` when `buildId` is
 *   not the running build, `RunningBuildUnassigned` when the running build has
 *   no current pointer, or `BuildPointerConflict` when `expectedReleaseId` is stale.
 * @throws {NotFoundError} With code `ReleaseNotFound` when `releaseId` does not exist.
 */
export async function assignReleaseToRunningBuild(context, args) {
    const {
        buildId,
        releaseId,
        expectedReleaseId,
        activatedBy,
    } = args ?? {};
    assertNonEmptyString(buildId, 'assignReleaseToRunningBuild: buildId');
    assertNonEmptyString(releaseId, 'assignReleaseToRunningBuild: releaseId');
    assertNonEmptyString(expectedReleaseId, 'assignReleaseToRunningBuild: expectedReleaseId');
    assertNonEmptyString(activatedBy, 'assignReleaseToRunningBuild: activatedBy');

    const runningBuildId = context.runtime.build.id ?? null;

    // A mismatch means the page rendering this request was served under a
    // different deploy; the admin panel never assigns a build it is not
    // currently running as.
    if (!runningBuildId || runningBuildId !== buildId) {
        throw new ConflictError(
            'The running build has changed. Reload and try again.',
            { code: 'RunningBuildMismatch' },
        );
    }

    const target = await getRelease(context, releaseId);
    if (!target) {
        throw new NotFoundError(
            `Release "${ releaseId }" was not found`,
            { code: 'ReleaseNotFound' },
        );
    }

    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        // The admin panel only moves an existing pointer; a first assignment
        // is out of scope and must go through the Publishing API.
        throw new ConflictError(
            `Build "${ buildId }" has no Release assigned`,
            { code: 'RunningBuildUnassigned' },
        );
    }
    if (pointer.rootHash !== expectedReleaseId) {
        throw new ConflictError(
            'The running Release has changed. Reload and try again.',
            { code: 'BuildPointerConflict' },
        );
    }

    // The pointer is authoritative; a missing current Release audit record
    // (lost or never written) still allows the assignment, just without a
    // meaningful rollback/publish distinction.
    const current = await getRelease(context, pointer.rootHash);
    const reason = (current && new Date(target.createdAt) < new Date(current.createdAt))
        ? 'rollback'
        : 'publish';

    return await assignRelease(context, {
        buildId,
        releaseId,
        precondition: expectedReleaseId,
        activatedBy,
        reason,
    });
}
