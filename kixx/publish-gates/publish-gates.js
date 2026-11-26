// The publish gates: the rules of REQUIREMENTS.md §5.3 that a server can
// enforce without git history. The Publishing API calls them for the deploy
// key, and Studio calls them in-process for a user, so both follow one rule
// (A9). See ./README.md.
//
// The validators never throw for bad input; they return problems, so a
// handler can merge them with its own into one 422. assignReleaseThroughGates()
// runs them again, so an in-process caller can't skip them.

import {
    assert,
    isBoolean,
    isNonEmptyString,
    isPlainObject,
} from '../assertions/mod.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/mod.js';
import { isValidCodeFingerprint, isValidGitObjectId } from '../code-fingerprint/mod.js';
import { isValidAssignmentId } from '../content-addressable-store/build-assignment.js';
import { isValidHash } from '../content-addressable-store/addressing.js';
import { ACTIVATION_REASONS, HISTORY_LIMITS } from '../content-addressable-store/publishing-history.js';


/**
 * What a build write means. `'prestage'` gives a build its code and its first
 * (or a carried-forward) Release; `'publish'` is a content-only publish to a
 * build that already exists.
 * @type {Set<string>}
 */
export const BUILD_ASSIGNMENT_INTENTS = new Set([ 'prestage', 'publish' ]);

const ASSIGNMENT_KEYS = new Set([
    'intent',
    'releaseId',
    'expectedAssignmentId',
    'reason',
    'actor',
    'sourceRevision',
    'summary',
    'code',
    'codeFingerprint',
    'force',
    'forceReason',
]);

const CODE_KEYS = [ 'revision', 'fingerprint' ];


/**
 * @typedef {Object} GateProblem
 * @property {string} message - What is wrong, for a Developer or a tool
 * @property {string} source - The field, relative to the assignment or Release, such as `'code.fingerprint'`
 */

/**
 * Finds every problem with the protocol 4 fields of a build assignment:
 * `intent`, `sourceRevision`, `summary`, `code`, `codeFingerprint`, `force`,
 * and `forceReason`. `releaseId`, `expectedAssignmentId`, and `reason` are
 * the caller's to check.
 *
 * Outside development a pre-stage requires `code` and `sourceRevision`, and a
 * content-only publish requires `sourceRevision` and `codeFingerprint`
 * (CONT-4, CONT-5, CONT-6). In development nothing is required, but a present
 * value is still checked. `undefined` and `null` both mean absent.
 * @param {Object} assignment - The assignment's fields
 * @param {Object} options
 * @param {boolean} options.isDevelopment - Whether the server runs in development
 * @returns {GateProblem[]} Every problem found; empty when the fields are acceptable
 */
export function findBuildAssignmentProblems(assignment, { isDevelopment }) {
    const problems = [];
    const report = (message, source) => problems.push({ message, source });
    const { intent, sourceRevision, summary, code, codeFingerprint, force, forceReason } = assignment;
    const isRequired = !isDevelopment;

    if (!BUILD_ASSIGNMENT_INTENTS.has(intent)) {
        report(`intent must be one of: ${ [ ...BUILD_ASSIGNMENT_INTENTS ].join(', ') }`, 'intent');
    }

    if (isPresent(sourceRevision)) {
        if (!isValidGitObjectId(sourceRevision)) {
            report('sourceRevision must be a commit id (40 or 64 lowercase hex characters)', 'sourceRevision');
        }
    } else if (isRequired && BUILD_ASSIGNMENT_INTENTS.has(intent)) {
        report('sourceRevision is required outside development', 'sourceRevision');
    }

    if (isPresent(summary)) {
        checkText(summary, 'summary', report);
    }

    if (intent === 'prestage') {
        if (isPresent(code)) {
            checkCode(code, report);
        } else if (isRequired) {
            report('code is required on a pre-stage outside development', 'code');
        }
        if (isPresent(codeFingerprint)) {
            report('codeFingerprint is not accepted on a pre-stage; send code instead', 'codeFingerprint');
        }
    }

    if (intent === 'publish') {
        if (isPresent(code)) {
            report('code is not accepted on a content-only publish; pre-stage the build instead', 'code');
        }
        if (isPresent(codeFingerprint)) {
            if (!isValidCodeFingerprint(codeFingerprint)) {
                report('codeFingerprint must be a code fingerprint, such as "kxfp1:" and 64 lowercase hex characters', 'codeFingerprint');
            }
        } else if (isRequired) {
            report('codeFingerprint is required on a content-only publish outside development', 'codeFingerprint');
        }
    }

    if (isPresent(force) && !isBoolean(force)) {
        report('force must be true or false', 'force');
    }
    if (isPresent(forceReason)) {
        checkText(forceReason, 'forceReason', report);
        if (force !== true) {
            report('forceReason is accepted only with force: true', 'forceReason');
        }
    } else if (force === true) {
        report('force: true requires a forceReason', 'forceReason');
    }

    return problems;
}

/**
 * Finds CONT-4's problems with a Release's provenance: outside development
 * `sourceRevision` is required, and whenever it is present it must be a
 * commit id. The store's `validateReleaseProvenance()` checks the rest.
 * @param {Object} provenance - Provenance submitted with a Release
 * @param {Object} options
 * @param {boolean} options.isDevelopment - Whether the server runs in development
 * @returns {GateProblem[]} Every problem found, with source `'provenance.sourceRevision'`
 */
export function findReleaseProvenanceProblems(provenance, { isDevelopment }) {
    const source = 'provenance.sourceRevision';
    const sourceRevision = isPlainObject(provenance) ? provenance.sourceRevision : undefined;

    if (isPresent(sourceRevision)) {
        if (!isValidGitObjectId(sourceRevision)) {
            return [{ message: 'provenance.sourceRevision must be a commit id (40 or 64 lowercase hex characters)', source }];
        }
        return [];
    }
    if (!isDevelopment) {
        return [{ message: 'provenance.sourceRevision is required outside development', source }];
    }
    return [];
}

/**
 * Assigns a Release to a build through the publish gates.
 *
 * Checks the assignment, then, for a content-only publish, reads the target
 * build: it must exist, and outside development it must have code. When both
 * the build's code and the request's `codeFingerprint` are present, they must
 * be equal (CONT-6). `force` never skips a check; it only records
 * `forceReason` on the Activation (CONT-7's override is the client's
 * ancestry check). A refusal changes nothing.
 *
 * Reading the pointer and then assigning is safe: a build's code is set once,
 * and a pointer moved in between fails `expectedAssignmentId`.
 * @param {Object} context - Request or execution context
 * @param {Object} store - The ContentAddressableStore service
 * @param {string} buildId - The target build
 * @param {Object} assignment - What to assign and record
 * @param {('prestage'|'publish')} assignment.intent - Pre-stage or content-only publish
 * @param {string} assignment.releaseId - Existing Release id
 * @param {(string|null)} [assignment.expectedAssignmentId] - The caller's observed assignment id, or null for unassigned
 * @param {string} assignment.reason - One of ACTIVATION_REASONS
 * @param {{type: string, id: string, name?: string}} assignment.actor - Who is assigning; the caller's, never chosen here
 * @param {string} [assignment.sourceRevision] - The commit being published
 * @param {string} [assignment.summary] - Plain-language summary of the change
 * @param {{revision: string, fingerprint: string}} [assignment.code] - The build's code; pre-stage only
 * @param {string} [assignment.codeFingerprint] - The published commit's fingerprint; content-only only
 * @param {boolean} [assignment.force] - The caller overrode its ancestry check
 * @param {string} [assignment.forceReason] - Why; required with `force: true`
 * @param {Object} options
 * @param {boolean} options.isDevelopment - Whether the server runs in development
 * @returns {Promise<Object>} The result of `store.assignRelease()`
 * @throws {ValidationError} With code `InvalidBuildAssignment` when a gate field is invalid
 * @throws {NotFoundError} With code `BuildNotFound` when a content-only publish targets an unassigned build
 * @throws {ConflictError} With code `BuildCodeUnknown` or `CodeFingerprintMismatch`, or the store's
 *   `BuildPointerConflict` or `BuildCodeMismatch`
 * @throws {AssertionError} When `releaseId`, `expectedAssignmentId`, `reason`, `actor`, or a key is malformed
 */
export async function assignReleaseThroughGates(context, store, buildId, assignment, { isDevelopment }) {
    assert(isPlainObject(assignment), 'assignReleaseThroughGates: assignment must be a plain object');
    assert(isBoolean(isDevelopment), 'assignReleaseThroughGates: isDevelopment must be a boolean');
    assert(isNonEmptyString(buildId), 'assignReleaseThroughGates: buildId must be a non-empty string');
    for (const key of Object.keys(assignment)) {
        assert(ASSIGNMENT_KEYS.has(key), `assignReleaseThroughGates: assignment has an unknown key "${ key }"`);
    }

    const {
        intent,
        releaseId,
        expectedAssignmentId,
        reason,
        actor,
        sourceRevision,
        summary,
        code,
        codeFingerprint,
        force,
        forceReason,
    } = assignment;

    assert(isValidHash(releaseId), 'assignReleaseThroughGates: releaseId must be a Release id');
    assert(
        expectedAssignmentId === undefined || expectedAssignmentId === null || isValidAssignmentId(expectedAssignmentId),
        'assignReleaseThroughGates: expectedAssignmentId must be an assignment id, null, or absent',
    );
    assert(ACTIVATION_REASONS.has(reason), 'assignReleaseThroughGates: reason must be one of ACTIVATION_REASONS');
    assert(isPlainObject(actor), 'assignReleaseThroughGates: actor must be a plain object');

    const problems = findBuildAssignmentProblems(assignment, { isDevelopment });
    if (problems.length) {
        const error = new ValidationError('Invalid Build assignment', { code: 'InvalidBuildAssignment' });
        problems.forEach((problem) => error.push(problem.message, problem.source));
        throw error;
    }

    if (intent === 'publish') {
        await checkContentOnlyPublish(context, store, buildId, codeFingerprint, isDevelopment);
    }

    const storeAssignment = { releaseId, reason, actor };
    if (expectedAssignmentId !== undefined) {
        storeAssignment.expectedAssignmentId = expectedAssignmentId;
    }
    if (isPresent(sourceRevision)) {
        storeAssignment.sourceRevision = sourceRevision;
    }
    if (isPresent(summary)) {
        storeAssignment.summary = summary;
    }
    if (force === true) {
        storeAssignment.forceReason = forceReason;
    }
    if (intent === 'prestage' && isPresent(code)) {
        storeAssignment.code = { revision: code.revision, fingerprint: code.fingerprint };
    }

    return await store.assignRelease(context, buildId, storeAssignment);
}

// CONT-6 on the server: the published commit's code must be the build's.
async function checkContentOnlyPublish(context, store, buildId, codeFingerprint, isDevelopment) {
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        throw new NotFoundError(
            `Build "${ buildId }" was not found. Pre-stage it before a content-only publish.`,
            { code: 'BuildNotFound' },
        );
    }

    // A build without code can only exist in development (S08 OP5).
    if (!pointer.code) {
        if (!isDevelopment) {
            throw new ConflictError(
                `Build "${ buildId }" has no code fingerprint. Pre-stage it with code before a content-only publish.`,
                { code: 'BuildCodeUnknown' },
            );
        }
        return;
    }

    if (isPresent(codeFingerprint) && codeFingerprint !== pointer.code.fingerprint) {
        throw new ConflictError(
            `The commit's code fingerprint "${ codeFingerprint }" differs from build "${ buildId }"'s "${ pointer.code.fingerprint }". Deploy the commit's code first.`,
            { code: 'CodeFingerprintMismatch' },
        );
    }
}

function checkCode(code, report) {
    if (!isPlainObject(code)) {
        report('code must be an object with revision and fingerprint', 'code');
        return;
    }
    for (const key of Object.keys(code)) {
        if (!CODE_KEYS.includes(key)) {
            report(`code.${ key } is not supported`, `code.${ key }`);
        }
    }
    if (!isValidGitObjectId(code.revision)) {
        report('code.revision must be a commit id (40 or 64 lowercase hex characters)', 'code.revision');
    }
    if (!isValidCodeFingerprint(code.fingerprint)) {
        report('code.fingerprint must be a code fingerprint, such as "kxfp1:" and 64 lowercase hex characters', 'code.fingerprint');
    }
}

function checkText(value, source, report) {
    if (!isNonEmptyString(value)) {
        report(`${ source } must be a non-empty string`, source);
    } else if (value.length > HISTORY_LIMITS.longTextLength) {
        report(`${ source } must be at most ${ HISTORY_LIMITS.longTextLength } characters`, source);
    }
}

function isPresent(value) {
    return value !== undefined && value !== null;
}
