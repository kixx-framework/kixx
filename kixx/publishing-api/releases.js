import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
} from '../errors/mod.js';
import { isValidHash } from '../content-addressable-store/addressing.js';
import { validateReleaseManifest } from '../content-addressable-store/release-manifest.js';
import { HISTORY_LIMITS, validateReleaseProvenance } from '../content-addressable-store/publishing-history.js';
import { isDevelopmentEnvironment } from '../config/environment.js';
import { deployKeyActor } from '../deploy-key/mod.js';
import { findReleaseProvenanceProblems } from '../publish-gates/mod.js';
import { JSON_API_CONTENT_TYPE } from '../http-router/http-router.js';
import {
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from './json-api.js';
import { MAX_MANIFEST_ENTRIES } from './constants.js';


/**
 * Creates and fully verifies a Release.
 * @param {Object} context - Request context behind the deploy key.
 * @param {Object} request - JSON:API Release request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Created JSON:API Release response.
 */
export async function createRelease(context, request, response) {
    const { manifest, provenance } = await parseReleaseRequest(context, request);
    const store = context.getService('ContentAddressableStore');

    let release;
    try {
        release = await store.createRelease(context, manifest, {
            provenance,
            createdBy: deployKeyActor(context),
        });
    } catch (cause) {
        throw classifyReleaseError(cause);
    }

    return response.respondWithJSON(201, releaseDocument(release), { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Verifies a Release without persisting its closure or metadata.
 * @param {Object} context - Active request context.
 * @param {Object} request - JSON:API Release request using stored objects.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API ReleaseValidation response.
 */
export async function validateRelease(context, request, response) {
    const { manifest } = await parseReleaseRequest(context, request);
    const store = context.getService('ContentAddressableStore');

    let result;
    try {
        result = await store.validateRelease(context, manifest);
    } catch (cause) {
        throw classifyReleaseError(cause);
    }
    return response.respondWithJSON(200, jsonApiResource({
        type: 'ReleaseValidation',
        id: result.releaseId,
        attributes: result,
    }), { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Lists Release history newest first.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying pagination values.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Paginated JSON:API Release collection.
 * @throws {BadRequestError} When a pagination parameter is invalid.
 */
export async function listReleases(context, request, response) {
    const store = context.getService('ContentAddressableStore');
    const page = await store.listReleases(context, paginationParams(request));

    return response.respondWithJSON(200, {
        data: page.items.map(releaseResource),
        meta: { cursor: page.cursor },
    }, { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Gets one Release metadata record.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying the Release id.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API Release response.
 * @throws {NotFoundError} When the Release metadata is absent.
 */
export async function getRelease(context, request, response) {
    const releaseId = request.pathnameParams.releaseId;
    const store = context.getService('ContentAddressableStore');
    const release = isValidHash(releaseId) ? await store.getRelease(context, releaseId) : null;
    if (!release) {
        throw releaseNotFound(releaseId);
    }
    return response.respondWithJSON(200, releaseDocument(release), { contentType: JSON_API_CONTENT_TYPE });
}

/**
 * Gets the complete immutable manifest for one Release.
 * @param {Object} context - Active request context.
 * @param {Object} request - Request carrying the Release id.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} JSON:API ReleaseManifest response.
 * @throws {NotFoundError} When the Release closure is absent.
 */
export async function getReleaseManifest(context, request, response) {
    const releaseId = request.pathnameParams.releaseId;
    const store = context.getService('ContentAddressableStore');
    const manifest = isValidHash(releaseId) ? await store.getReleaseManifest(context, releaseId) : null;
    if (!manifest) {
        throw releaseNotFound(releaseId);
    }
    return response.respondWithJSON(200, jsonApiResource({
        type: 'ReleaseManifest',
        id: releaseId,
        attributes: { manifest },
    }), { contentType: JSON_API_CONTENT_TYPE });
}

// The service treats malformed input as a programmer error, so everything a
// client sends is checked here first: provenance, then the manifest.
async function parseReleaseRequest(context, request) {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'Release');
    if (!attributes.manifest || !Object.hasOwn(attributes, 'manifest')) {
        throw new BadRequestError('Release attributes.manifest is required.');
    }

    const provenance = Object.hasOwn(attributes, 'provenance') ? attributes.provenance : {};
    assertValidProvenance(provenance, isDevelopmentEnvironment(context.config));

    let files;
    try {
        files = validateReleaseManifest(attributes.manifest);
    } catch (cause) {
        throw classifyReleaseError(cause);
    }
    if (files.length > MAX_MANIFEST_ENTRIES) {
        throw new BadRequestError(`A Release may contain at most ${ MAX_MANIFEST_ENTRIES } manifest entries.`);
    }

    return { manifest: attributes.manifest, provenance };
}

// Every provenance problem in one 422: the store's field rules, then CONT-4's
// commit id rule for any field the store didn't already report.
function assertValidProvenance(provenance, isDevelopment) {
    const error = new ValidationError('Invalid Release provenance', { code: 'InvalidProvenance' });

    try {
        validateReleaseProvenance(provenance);
    } catch (cause) {
        cause.errors.forEach((entry) => error.push(entry.message, entry.source));
    }

    const reported = new Set(error.errors.map((entry) => entry.source));
    for (const problem of findReleaseProvenanceProblems(provenance, { isDevelopment })) {
        if (!reported.has(problem.source)) {
            error.push(problem.message, problem.source);
        }
    }

    if (error.length) {
        throw error;
    }
}

function classifyReleaseError(cause) {
    if (cause.name !== 'ValidationError') {
        return cause;
    }
    const errors = cause.errors ?? [];
    if (errors.some((error) => error.message.includes(' has size '))) {
        return new ConflictError('A stored object size disagrees with the manifest.', {
            cause,
            code: 'ObjectSizeMismatch',
        });
    }
    const code = errors.some((error) => error.message.includes(' is missing'))
        ? 'MissingContentObjects'
        : 'InvalidReleaseManifest';
    const error = new ValidationError(cause.message, { cause, code });
    errors.forEach((entry) => error.push(entry.message, entry.source));
    return error;
}

function releaseDocument(release) {
    return { data: releaseResource(release) };
}

// Attributes are copied by name, so a field the store adds later can't reach
// the wire unannounced.
function releaseResource(release) {
    return {
        type: 'Release',
        id: release.releaseId,
        attributes: {
            createdAt: release.createdAt,
            createdBy: actorAttributes(release.createdBy),
            objectCount: release.objectCount,
            totalBytes: release.totalBytes,
            contractVersion: release.contractVersion,
            provenance: release.provenance,
        },
    };
}

function actorAttributes(actor) {
    return { type: actor.type, id: actor.id, name: actor.name };
}

function releaseNotFound(releaseId) {
    return new NotFoundError(`Release "${ releaseId }" was not found.`, { code: 'ReleaseNotFound' });
}

// The service asserts its paging options, so every public value is checked
// here. A malformed non-empty cursor is left to the service's own 400.
function paginationParams(request) {
    const { cursor, limit } = request.queryParams ?? {};
    if (Array.isArray(cursor) || Array.isArray(limit)) {
        throw new BadRequestError('Pagination parameters may appear only once.');
    }

    const params = {};

    if (cursor !== undefined) {
        if (cursor === '') {
            throw new BadRequestError('The cursor is invalid.', { code: 'InvalidCursor' });
        }
        params.cursor = cursor;
    }

    if (limit !== undefined) {
        const parsedLimit = Number(limit);
        if (!/^\d+$/.test(limit) || parsedLimit < 1 || parsedLimit > HISTORY_LIMITS.pageSize) {
            throw new BadRequestError(`limit must be an integer from 1 through ${ HISTORY_LIMITS.pageSize }.`);
        }
        params.limit = parsedLimit;
    }

    return params;
}

export { paginationParams };
