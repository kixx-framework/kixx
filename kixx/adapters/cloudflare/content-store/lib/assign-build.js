import { isValidAssignmentId } from '../../../../content-addressable-store/build-assignment.js';
import { assert, assertFunction, assertNonEmptyString, isPlainObject } from '../../../../assertions/mod.js';
import { BUILD_ASSIGNMENT_OUTCOME } from '../../../../content-addressable-store/content-store-interface.js';
import { normalizeActivation, normalizeCodeInfo } from '../../../../content-addressable-store/publishing-history.js';


export const BUILD_POINTER_COLUMNS = 'root_hash, assigned_at, assignment_id, code_revision, code_fingerprint';

/**
 * @param {Object} row - A `builds` row holding the pointer columns
 * @returns {import('../../../../content-addressable-store/content-store-interface.js').ContentBuildPointer}
 */
export function pointerFromRow(row) {
    return {
        rootHash: row.root_hash,
        assignedAt: row.assigned_at,
        assignmentId: row.assignment_id,
        code: codeFromRow(row),
    };
}

/**
 * Runs the synchronous Durable Object SQL assignment operation.
 *
 * The caller must invoke this inside one synchronous storage transaction.
 * The pointer is written before the Activation, so a failed Activation
 * insert undoes the pointer write it follows.
 * @param {{exec: Function}} sql - Durable Object SQLite handle
 * @param {string} buildId - Build identifier to assign
 * @param {import('../../../../content-addressable-store/content-store-interface.js').ContentBuildAssignment} assignment - Desired closure, optional pointer precondition, the Activation to record, and optional code info
 * @param {Object} stamps
 * @param {function(): number} stamps.now - Clock returning milliseconds
 * @param {function(): string} stamps.randomUUID - Source of assignment identities
 * @returns {import('../../../../content-addressable-store/content-store-interface.js').ContentBuildAssignmentResult} Captured assignment result
 */
export default function assignBuild(sql, buildId, assignment, stamps) {
    assertNonEmptyString(buildId, 'assignBuild: buildId');
    assert(isPlainObject(assignment), 'assignBuild: assignment must be a plain object');
    assert(!Object.hasOwn(assignment, 'expectedRootHash'), 'assignBuild: use expectedAssignmentId');

    const { rootHash, expectedAssignmentId } = assignment;
    assertNonEmptyString(rootHash, 'assignBuild: rootHash');
    if (expectedAssignmentId !== undefined && expectedAssignmentId !== null) {
        assert(isValidAssignmentId(expectedAssignmentId), 'assignBuild: expectedAssignmentId');
    }

    const activation = normalizeActivation(assignment.activation, 'assignBuild: assignment.activation');
    const code = normalizeCodeInfo(assignment.code, 'assignBuild: assignment.code');

    assertFunction(stamps?.now, 'assignBuild: stamps.now');
    assertFunction(stamps?.randomUUID, 'assignBuild: stamps.randomUUID');

    const closureRows = sql.exec(
        'SELECT 1 FROM closure_entries WHERE root_hash = ? LIMIT 1',
        rootHash,
    ).toArray();
    if (closureRows.length === 0) {
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.MISSING_CLOSURE };
    }

    const [ current ] = sql.exec(
        `SELECT ${ BUILD_POINTER_COLUMNS } FROM builds WHERE build_id = ?`,
        buildId,
    ).toArray();
    if (expectedAssignmentId !== undefined && expectedAssignmentId !== (current?.assignment_id ?? null)) {
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.CONFLICT };
    }

    // A build's code info is set once: later assignments keep it, repeat
    // it, or are refused.
    const storedCode = current ? codeFromRow(current) : null;
    if (code && storedCode && (code.revision !== storedCode.revision || code.fingerprint !== storedCode.fingerprint)) {
        return { outcome: BUILD_ASSIGNMENT_OUTCOME.CODE_MISMATCH, code: storedCode };
    }
    const effectiveCode = storedCode ?? code;

    if (current?.root_hash === rootHash) {
        if (!storedCode && code) {
            sql.exec(
                'UPDATE builds SET code_revision = ?, code_fingerprint = ? WHERE build_id = ?',
                code.revision,
                code.fingerprint,
                buildId,
            );
        }
        return {
            outcome: BUILD_ASSIGNMENT_OUTCOME.UNCHANGED,
            pointer: { ...pointerFromRow(current), code: effectiveCode },
            previousRootHash: rootHash,
        };
    }

    const previousRootHash = current?.root_hash ?? null;
    const assignmentId = stamps.randomUUID();
    const assignedAt = new Date(stamps.now()).toISOString();

    sql.exec(
        `
        INSERT INTO builds (build_id, root_hash, assigned_at, assignment_id, code_revision, code_fingerprint)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(build_id) DO UPDATE SET
            root_hash = EXCLUDED.root_hash,
            assigned_at = EXCLUDED.assigned_at,
            assignment_id = EXCLUDED.assignment_id,
            code_revision = EXCLUDED.code_revision,
            code_fingerprint = EXCLUDED.code_fingerprint
        `,
        buildId,
        rootHash,
        assignedAt,
        assignmentId,
        effectiveCode?.revision ?? null,
        effectiveCode?.fingerprint ?? null,
    );

    sql.exec(
        `
        INSERT INTO activations (
            build_id, assignment_id, from_release_id, to_release_id, activated_at,
            reason, actor_type, actor_id, actor_name, source_revision, summary, force_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        buildId,
        assignmentId,
        previousRootHash,
        rootHash,
        assignedAt,
        activation.reason,
        activation.actor.type,
        activation.actor.id,
        activation.actor.name,
        activation.sourceRevision,
        activation.summary,
        activation.forceReason,
    );

    return {
        outcome: BUILD_ASSIGNMENT_OUTCOME.ASSIGNED,
        pointer: { rootHash, assignedAt, assignmentId, code: effectiveCode },
        previousRootHash,
    };
}

function codeFromRow(row) {
    if (row.code_revision === null || row.code_fingerprint === null) {
        return null;
    }
    return { revision: row.code_revision, fingerprint: row.code_fingerprint };
}
