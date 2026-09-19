import {
    BadRequestError,
    NotFoundError,
    OperationalError,
    PreconditionFailedError,
    ValidationError,
} from '../../../../kixx/errors/mod.js';
import { isValidAssignmentId } from '../../../../kixx/content-addressable-store/build-assignment.js';
import { isValidHash } from '../../../../kixx/content-addressable-store/addressing.js';
import { ACTIVATION_REASONS } from '../../../collections/activation-record.js';
import { assignRelease as assignReleaseScript } from '../../../transaction-scripts/publishing/assign-release.js';
import { listActivations as listActivationsScript } from '../../../transaction-scripts/publishing/list-activations.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { paginationParams } from './releases.js';


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
        data: builds.map(buildResource),
    }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Gets one authoritative build pointer, whether or not it is running.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying the build route id.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API Build response with an ETag.
 * @throws {NotFoundError} When the build is unassigned.
 */
export async function getBuild(context, request, response) {
    const buildId = request.pathnameParams.buildId;
    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        throw new NotFoundError(`Build "${ buildId }" was not found.`, { code: 'BuildNotFound' });
    }
    return response.respondWithJSON(200, {
        data: buildResource({ buildId, ...pointer }),
    }, {
        contentType: JSON_API_CONTENT_TYPE,
        headers: buildPointerHeaders(pointer.assignmentId),
    });
}

/**
 * Assigns a Release using a mandatory JSON assignment identity.
 * @param {Object} context - Authenticated request context.
 * @param {Object} request - JSON:API Build request with an expected assignment identity.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Resulting JSON:API Build response.
 * @throws {PreconditionFailedError} When the pointer precondition is stale.
 */
export async function putBuild(context, request, response) {
    assertJsonApiContentType(request);
    const buildId = request.pathnameParams.buildId;
    const { id, attributes } = await parseJsonApiResource(request, 'Build');
    const { releaseId, expectedAssignmentId, reason = 'publish' } = attributes;
    const error = new ValidationError('Invalid Build assignment', { code: 'InvalidBuildAssignment' });
    if (id !== buildId) {
        error.push('Build resource id must match the route build id', 'data.id');
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

    let pointer;
    try {
        pointer = await assignReleaseScript(context, {
            buildId,
            releaseId,
            expectedAssignmentId,
            reason,
            activatedBy: context.user.id,
        });
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
        data: buildResource({
            buildId: pointer.buildId,
            rootHash: pointer.releaseId,
            assignedAt: pointer.assignedAt,
            assignmentId: pointer.assignmentId,
        }),
    }, {
        contentType: JSON_API_CONTENT_TYPE,
        headers: buildPointerHeaders(pointer.assignmentId),
    });
}

/**
 * Lists one build's activation history newest first.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying build and pagination values.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Paginated JSON:API Activation collection.
 * @throws {NotFoundError} When the build is unassigned.
 */
export async function listBuildActivations(context, request, response) {
    const buildId = request.pathnameParams.buildId;
    const store = context.getService('ContentAddressableStore');
    const pointer = await store.getBuildPointer(context, buildId);
    if (!pointer) {
        throw new NotFoundError(`Build "${ buildId }" was not found.`, { code: 'BuildNotFound' });
    }
    const page = await listActivationsScript(context, {
        buildId,
        ...paginationParams(request),
    });
    return response.respondWithJSON(200, {
        data: page.items.map(activationResource),
        meta: { cursor: page.cursor },
    }, { contentType: JSON_API_CONTENT_TYPE });
}

function buildResource(build) {
    const buildId = build.buildId ?? build.id;
    return {
        type: 'Build',
        id: buildId,
        attributes: {
            releaseId: build.rootHash,
            assignedAt: build.assignedAt,
            assignmentId: build.assignmentId,
        },
    };
}

function activationResource(activation) {
    const { id, type: _type, meta: _meta, buildActivationKey: _key, ...attributes } = activation;
    return { type: 'Activation', id, attributes };
}

function quoteEtag(value) {
    return `"${ value }"`;
}

function buildPointerHeaders(assignmentId) {
    return {
        // Preserve the representation validator through intermediary transforms.
        // Writes use only the identity in JSON, independently of this header.
        'cache-control': 'no-transform',
        etag: quoteEtag(assignmentId),
    };
}
