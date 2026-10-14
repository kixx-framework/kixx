/**
 * Build pointer assignment under the mandatory protocol 2 precondition.
 * @module publishing/assign-release
 */

import negotiateCapabilities from './negotiate-capabilities.js';
import {
    BuildNotFoundError,
    BuildPointerConflictError,
} from './publishing-api-error.js';

/**
 * Assigns a Release using the assignment identity observed immediately before it.
 *
 * Reads the build pointer and quotes the `assignmentId` it returns. A build
 * that has never been assigned reads as `404` and is written with a `null`
 * precondition, which is how bootstrapping a new build id works.
 * @param {Object} args - Assignment inputs
 * @param {Object} args.client - Publishing API client
 * @param {string} args.buildId - Build pointer id
 * @param {string} args.releaseId - Release to assign
 * @param {string} [args.reason=publish] - Assignment audit reason
 * @returns {Promise<Object>} Resulting build pointer record
 * @throws {UnsupportedServerError} When the server does not serve this protocol
 * @throws {BuildPointerConflictError} When the pointer moved after it was read
 */
export default async function assignRelease(args) {
    const {
        client,
        buildId,
        releaseId,
        reason = 'publish',
    } = args ?? {};

    // Refuse an incompatible server before reading anything, so a caller can
    // tell "nothing was attempted" from "the assignment failed".
    await negotiateCapabilities(client);

    let expectedAssignmentId;

    try {
        // The precondition is the opaque identity from the response body.
        // Protocol 2 removed the Build ETag, and an identity may never be
        // derived from a release id or any other observable value.
        const build = await client.getBuild(buildId);
        expectedAssignmentId = build.assignmentId;
    } catch (error) {
        if (!(error instanceof BuildNotFoundError)) {
            throw error;
        }

        expectedAssignmentId = null;
    }

    return await assignWithConflictContext({
        client,
        buildId,
        releaseId,
        reason,
        expectedAssignmentId,
    });
}

async function assignWithConflictContext(args) {
    const {
        client,
        buildId,
        releaseId,
        reason,
        expectedAssignmentId,
    } = args;

    try {
        return await client.assignBuild(buildId, releaseId, {
            expectedAssignmentId,
            reason,
        });
    } catch (error) {
        if (!(error instanceof BuildPointerConflictError)) {
            throw error;
        }

        const observed = await readObservedPointer(client, buildId);

        throw makeConflictError({
            cause: error,
            buildId,
            releaseId,
            expectedAssignmentId,
            observed,
        });
    }
}

/**
 * Reads the pointer that won the race, for the conflict report alone.
 *
 * Best-effort by design: a failed diagnostic read must not replace the
 * conflict the operator actually needs to see.
 * @param {Object} client - Publishing API client
 * @param {string} buildId - Build pointer id
 * @returns {Promise<?Object>} Current build pointer, or null when unreadable
 */
async function readObservedPointer(client, buildId) {
    try {
        return await client.getBuild(buildId);
    } catch {
        return null;
    }
}

function makeConflictError(args) {
    const {
        cause,
        buildId,
        releaseId,
        expectedAssignmentId,
        observed,
    } = args;

    const lines = [
        `Build pointer conflict for "${ buildId }": the pointer changed after this command ` +
        'read it. The assignment was refused and was not retried, because retrying would ' +
        'overwrite whatever moved it.',
        `  Intended:  Release ${ releaseId }`,
        `  Expected:  ${ describeAssignment(expectedAssignmentId) }`,
        `  Observed:  ${ describeObserved(observed) }`,
        'Read the build and reconcile before assigning again. Another publisher may have ' +
        'assigned content this command was about to replace.',
    ];

    const error = new BuildPointerConflictError(lines.join('\n'), {
        status: cause.status,
        errors: cause.errors,
        method: cause.method,
        url: cause.url,
        attempts: cause.attempts,
        cause,
    });

    // PublishingApiError owns transport fields only. The assignment context
    // is this module's concern, so it is attached here rather than widening
    // the transport error for one caller.
    Object.defineProperties(error, {
        buildId: {
            enumerable: true,
            value: buildId,
        },
        intendedReleaseId: {
            enumerable: true,
            value: releaseId,
        },
        expectedAssignmentId: {
            enumerable: true,
            value: expectedAssignmentId,
        },
        observedReleaseId: {
            enumerable: true,
            value: observed?.releaseId ?? null,
        },
        observedAssignmentId: {
            enumerable: true,
            value: observed?.assignmentId ?? null,
        },
    });

    return error;
}

function describeAssignment(expectedAssignmentId) {
    if (expectedAssignmentId === null) {
        return 'a build with no pointer at all';
    }
    return `assignment ${ expectedAssignmentId }`;
}

function describeObserved(observed) {
    if (!observed) {
        return 'unavailable; re-reading the build for diagnostics also failed';
    }
    return `Release ${ observed.releaseId }, assignment ${ observed.assignmentId }`;
}
