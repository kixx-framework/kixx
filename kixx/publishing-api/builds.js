import {
    BadRequestError,
    NotFoundError,
    OperationalError,
    PreconditionFailedError,
    ValidationError,
} from '../errors/mod.js';
import { isValidAssignmentId } from '../content-addressable-store/build-assignment.js';
import { isValidHash } from '../content-addressable-store/addressing.js';
import { ACTIVATION_REASONS } from '../content-addressable-store/publishing-history.js';
import { isDevelopmentEnvironment } from '../config/environment.js';
import { deployKeyActor } from '../deploy-key/mod.js';
import { assignReleaseThroughGates, findBuildAssignmentProblems } from '../publish-gates/mod.js';
import { JSON_API_CONTENT_TYPE } from '../http-router/http-router.js';
import { assertJsonApiContentType, parseJsonApiResource } from './json-api.js';
import { paginationParams } from './releases.js';


// Every other attribute is refused, so a field a later protocol adds is never
// silently ignored by a server that doesn't know it.
const BUILD_ATTRIBUTES = new Set([
    'releaseId',
    'expectedAssignmentId',
    'reason',
    'intent',
    'sourceRevision',
    'summary',
    'code',
    'codeFingerprint',
    'force',
    'forceReason',
]);


/**
 * Lists every assigned build pointer newest first.
 * @param {Object} context - Active request context.
 * @param {Object} _request - Incoming request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API build collection response.
 */
export async function listBuilds(context, _request, response) {
    const store = context.getService('ContentAddressableStore');
    const builds = await store.listBuilds(context);
    return response.respondWithJSON(200, {
        data: builds.map((build) => buildFromPointer(build.buildId, build)),
    }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Gets one authoritative build pointer, whether or not it is running.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying the build route id.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API Build response.
 * @throws {NotFoundError} When the build is unassigned.
 */
export async function getBuild(context, request, response) {
    const buildId = request.pathnameParams.buildId;
    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        throw new NotFoundError(`Build "${ buildId }" was not found.`, { code: 'BuildNotFound' });
    }
    const liveSourceRevision = await readLiveSourceRevision(context, store, buildId);
    return response.respondWithJSON(200, {
        data: buildFromPointer(buildId, pointer, liveSourceRevision),
    }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Assigns a Release through the publish gates, using a mandatory JSON
 * assignment identity. The write declares its intent: a pre-stage or a
 * content-only publish (protocol 4).
 * @param {Object} context - Request context behind the deploy key.
 * @param {Object} request - JSON:API Build request with an expected assignment identity.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Resulting JSON:API Build response, with `liveSourceRevision`.
 * @throws {ValidationError} With code `InvalidBuildAssignment` for a bad or unknown attribute.
 * @throws {PreconditionFailedError} When the pointer precondition is stale.
 * @throws {NotFoundError} With code `BuildNotFound` or `ReleaseNotFound`.
 * @throws {ConflictError} With code `BuildCodeUnknown`, `CodeFingerprintMismatch`, or `BuildCodeMismatch`.
 */
export async function putBuild(context, request, response) {
    assertJsonApiContentType(request);
    const buildId = request.pathnameParams.buildId;
    const { id, attributes } = await parseJsonApiResource(request, 'Build');
    const { releaseId, expectedAssignmentId, reason = 'publish' } = attributes;
    const isDevelopment = isDevelopmentEnvironment(context.config);
    const error = new ValidationError('Invalid Build assignment', { code: 'InvalidBuildAssignment' });
    if (id !== buildId) {
        error.push('Build resource id must match the route build id', 'data.id');
    }
    for (const name of Object.keys(attributes)) {
        if (!BUILD_ATTRIBUTES.has(name)) {
            error.push(`Build attributes.${ name } is not supported`, `attributes.${ name }`);
        }
    }
    if (!isValidHash(releaseId)) {
        error.push('Build attributes.releaseId must be a valid Release id', 'attributes.releaseId');
    }
    if (!ACTIVATION_REASONS.has(reason)) {
        error.push('Build attributes.reason is invalid', 'attributes.reason');
    }
    if (Object.hasOwn(attributes, 'expectedAssignmentId') && expectedAssignmentId !== null && !isValidAssignmentId(expectedAssignmentId)) {
        error.push('Build attributes.expectedAssignmentId must be an assignment UUID or null', 'attributes.expectedAssignmentId');
    }
    for (const problem of findBuildAssignmentProblems(attributes, { isDevelopment })) {
        error.push(`Build attributes.${ problem.message }`, `attributes.${ problem.source }`);
    }
    if (error.length) {
        throw error;
    }

    if (!Object.hasOwn(attributes, 'expectedAssignmentId')) {
        throw new OperationalError('A build assignment requires attributes.expectedAssignmentId in JSON.', {
            expected: true,
            httpStatusCode: 428,
            code: 'PreconditionRequired',
            name: 'PreconditionRequiredError',
        });
    }
    if (request.headers.has('if-match') || request.headers.has('if-none-match')) {
        throw new BadRequestError('Build write preconditions belong in JSON attributes.expectedAssignmentId; omit If-Match and If-None-Match.');
    }

    const store = context.getService('ContentAddressableStore');

    let pointer;
    try {
        pointer = await assignReleaseThroughGates(context, store, buildId, {
            intent: attributes.intent,
            releaseId,
            expectedAssignmentId,
            reason,
            actor: deployKeyActor(context),
            sourceRevision: attributes.sourceRevision,
            summary: attributes.summary,
            code: attributes.code,
            codeFingerprint: attributes.codeFingerprint,
            force: attributes.force,
            forceReason: attributes.forceReason,
        }, { isDevelopment });
    } catch (cause) {
        if (cause.code === 'BuildPointerConflict') {
            throw new PreconditionFailedError(cause.message, {
                cause,
                code: 'BuildPointerConflict',
            });
        }
        throw cause;
    }

    return response.respondWithJSON(200, {
        data: buildResource(pointer, await readLiveSourceRevision(context, store, buildId)),
    }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Lists one build's activation history newest first.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying build and pagination values.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Paginated JSON:API Activation collection.
 * @throws {NotFoundError} When the build is unassigned.
 * @throws {BadRequestError} When a pagination parameter is invalid.
 */
export async function listBuildActivations(context, request, response) {
    const buildId = request.pathnameParams.buildId;
    const page = paginationParams(request);
    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        throw new NotFoundError(`Build "${ buildId }" was not found.`, { code: 'BuildNotFound' });
    }

    const { items, cursor } = await store.listActivations(context, { buildId, ...page });

    return response.respondWithJSON(200, {
        data: items.map(activationResource),
        meta: { cursor },
    }, { contentType: JSON_API_CONTENT_TYPE });
}

// The live commit is the newest Activation's sourceRevision (CONT-7): the
// Activation is written with the pointer, so it is the current assignment's.
async function readLiveSourceRevision(context, store, buildId) {
    const { items } = await store.listActivations(context, { buildId, limit: 1 });
    return items[0]?.sourceRevision ?? null;
}

// A stored pointer names its Release `rootHash`; the wire calls it `releaseId`.
function buildFromPointer(buildId, pointer, liveSourceRevision) {
    return buildResource({
        buildId,
        releaseId: pointer.rootHash,
        assignedAt: pointer.assignedAt,
        assignmentId: pointer.assignmentId,
        code: pointer.code,
    }, liveSourceRevision);
}

// Only single-build responses carry liveSourceRevision: reading it costs one
// history read per build.
function buildResource({ buildId, releaseId, assignedAt, assignmentId, code }, liveSourceRevision) {
    const attributes = {
        releaseId,
        assignedAt,
        assignmentId,
        code: code ? { revision: code.revision, fingerprint: code.fingerprint } : null,
    };
    if (liveSourceRevision !== undefined) {
        attributes.liveSourceRevision = liveSourceRevision;
    }
    return { type: 'Build', id: buildId, attributes };
}

// Attributes are copied by name, so a field the store adds later can't reach
// the wire unannounced.
function activationResource(activation) {
    const { actor } = activation;

    return {
        type: 'Activation',
        id: `${ activation.buildId }:${ activation.assignmentId }`,
        attributes: {
            buildId: activation.buildId,
            assignmentId: activation.assignmentId,
            fromReleaseId: activation.fromReleaseId,
            toReleaseId: activation.toReleaseId,
            activatedAt: activation.activatedAt,
            reason: activation.reason,
            actor: { type: actor.type, id: actor.id, name: actor.name },
            sourceRevision: activation.sourceRevision,
            summary: activation.summary,
            forceReason: activation.forceReason,
        },
    };
}
