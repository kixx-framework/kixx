import { isValidAssignmentId } from '../../../kixx/content-addressable-store/build-assignment.js';
import { assert, assertNonEmptyString, isPlainObject } from '../../../kixx/assertions/mod.js';
import { BUILD_ASSIGNMENT_OUTCOME } from '../../../kixx/content-addressable-store/content-store-interface.js';

/**
 * Runs the synchronous Durable Object SQL assignment operation.
 *
 * The caller must invoke this without an `await` between SQL operations so
 * the Durable Object serializes the read, comparison, and optional write.
 * @param {{exec: Function}} sql - Durable Object SQLite handle
 * @param {string} buildId - Build identifier to assign
 * @param {{rootHash: string, expectedAssignmentId?: (string|null)}} assignment - Desired closure and optional pointer precondition
 * @returns {import('../../../kixx/content-addressable-store/content-store-interface.js').ContentBuildAssignmentResult} Captured assignment result
 */
export default function assignBuild(sql, buildId, assignment) {
    assertNonEmptyString(buildId, 'assignBuild: buildId');
    assert(isPlainObject(assignment), 'assignBuild: assignment must be a plain object');
    assert(!Object.hasOwn(assignment, 'expectedRootHash'), 'assignBuild: use expectedAssignmentId');

    const { rootHash, expectedAssignmentId } = assignment;
    assertNonEmptyString(rootHash, 'assignBuild: rootHash');
    if (expectedAssignmentId !== undefined && expectedAssignmentId !== null) {
        assert(isValidAssignmentId(expectedAssignmentId), 'assignBuild: expectedAssignmentId');
    }

    const closureRows = sql.exec(
        'SELECT 1 FROM closure_entries WHERE root_hash = ? LIMIT 1',
        rootHash,
    ).toArray();
    if (closureRows.length === 0) {
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE };
    }

    const [ current ] = sql.exec(
        'SELECT root_hash, assigned_at, assignment_id FROM builds WHERE build_id = ?',
        buildId,
    ).toArray();
    const currentRootHash = current?.root_hash ?? null;
    if (expectedAssignmentId !== undefined && expectedAssignmentId !== (current?.assignment_id ?? null)) {
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.CONFLICT };
    }

    if (currentRootHash === rootHash) {
        const pointer = { rootHash: current.root_hash, assignedAt: current.assigned_at, assignmentId: current.assignment_id };
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.UNCHANGED, pointer, previousRootHash: pointer.rootHash };
    }

    const assignmentId = crypto.randomUUID();
    const assignedAt = new Date().toISOString();
    sql.exec(`
        INSERT INTO builds (build_id, root_hash, assigned_at, assignment_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(build_id) DO UPDATE SET
            root_hash = EXCLUDED.root_hash,
            assigned_at = EXCLUDED.assigned_at,
            assignment_id = EXCLUDED.assignment_id
    `, buildId, rootHash, assignedAt, assignmentId);
    return {
        outcome: BUILD_ASSIGNMENT_OUTCOME.ASSIGNED,
        pointer: { rootHash, assignedAt, assignmentId },
        previousRootHash: currentRootHash,
    };
}
