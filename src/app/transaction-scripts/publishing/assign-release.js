import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { ACTIVATION_REASONS } from '../../collections/activation-record.js';


/**
 * Assigns a Release and best-effort appends its audit history.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Assignment arguments.
 * @param {string} args.buildId - Build pointer to assign.
 * @param {string} args.releaseId - Release to assign.
 * @param {string|null} [args.precondition] - Expected current Release or null for unassigned.
 * @param {string} args.activatedBy - Publishing token id.
 * @param {'publish'|'rollback'|'carry-forward'|'restore'} args.reason - Audit reason.
 * @returns {Promise<Object>} Authoritative resulting build pointer.
 * @throws {NotFoundError} When the Release does not exist.
 * @throws {ConflictError} When the pointer precondition fails.
 */
export async function assignRelease(context, args) {
    const {
        buildId,
        releaseId,
        precondition,
        activatedBy,
        reason,
    } = args ?? {};
    assertNonEmptyString(buildId, 'assignRelease: buildId');
    assertNonEmptyString(releaseId, 'assignRelease: releaseId');
    assertNonEmptyString(activatedBy, 'assignRelease: activatedBy');
    assertNonEmptyString(reason, 'assignRelease: reason');
    if (!ACTIVATION_REASONS.has(reason)) {
        throw new TypeError(`assignRelease: unsupported reason "${ reason }"`);
    }

    const store = context.getService('ContentAddressableStore');
    const activations = context.getCollection('Activation');
    const current = await store.getBuildPointer(context, buildId);
    const pointer = await store.assignRelease(context, buildId, { releaseId, precondition });

    try {
        await activations.append(context, {
            buildId,
            fromReleaseId: current?.rootHash ?? null,
            toReleaseId: releaseId,
            activatedBy,
            reason,
        });
    } catch (cause) {
        // The pointer is authoritative and has already moved. Failing the
        // request would invite a retry that misrepresents the completed write.
        context.logger.error('failed to record Release activation', {
            buildId,
            fromReleaseId: current?.rootHash ?? null,
            toReleaseId: releaseId,
            activatedBy,
            reason,
        }, cause);
    }

    return pointer;
}
