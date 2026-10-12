import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
} from '../../../../kixx/errors/mod.js';
import { validateReleaseManifest } from '../../../../kixx/content-addressable-store/release-manifest.js';
import { createRelease as createReleaseScript } from '../../../transaction-scripts/publishing/create-release.js';
import { getRelease as getReleaseScript } from '../../../transaction-scripts/publishing/get-release.js';
import { listReleases as listReleasesScript } from '../../../transaction-scripts/publishing/list-releases.js';
import {
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    parseJsonApiResource,
} from '../../lib/json-api.js';
import { MAX_MANIFEST_ENTRIES } from './constants.js';


/**
 * Creates and fully verifies a Release.
 * @param {Object} context - Authenticated request context.
 * @param {Object} request - JSON:API Release request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Created JSON:API Release response.
 */
export async function createRelease(context, request, response) {
    const attributes = await parseReleaseRequest(request);
    let manifest;
    try {
        manifest = enforceManifestEntryLimit(attributes.manifest);
    } catch (cause) {
        throw classifyReleaseError(cause);
    }

    let release;
    try {
        release = await createReleaseScript(context, {
            manifest,
            provenance: attributes.provenance ?? {},
            createdBy: context.user.id,
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
    const attributes = await parseReleaseRequest(request);
    let manifest;
    try {
        manifest = enforceManifestEntryLimit(attributes.manifest);
    } catch (cause) {
        throw classifyReleaseError(cause);
    }
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
 */
export async function listReleases(context, request, response) {
    const page = await listReleasesScript(context, paginationParams(request));
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
    const release = await getReleaseScript(context, releaseId);
    if (!release) {
        throw new NotFoundError(`Release "${ releaseId }" was not found.`, { code: 'ReleaseNotFound' });
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
    const manifest = await store.getReleaseManifest(context, releaseId);
    if (!manifest) {
        throw new NotFoundError(`Release "${ releaseId }" was not found.`, { code: 'ReleaseNotFound' });
    }
    return response.respondWithJSON(200, jsonApiResource({
        type: 'ReleaseManifest',
        id: releaseId,
        attributes: { manifest },
    }), { contentType: JSON_API_CONTENT_TYPE });
}

async function parseReleaseRequest(request) {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'Release');
    if (!attributes.manifest || !Object.hasOwn(attributes, 'manifest')) {
        throw new BadRequestError('Release attributes.manifest is required.');
    }
    return attributes;
}

function enforceManifestEntryLimit(manifest) {
    const files = validateReleaseManifest(manifest);
    if (files.length > MAX_MANIFEST_ENTRIES) {
        throw new BadRequestError(`A Release may contain at most ${ MAX_MANIFEST_ENTRIES } manifest entries.`);
    }
    return manifest;
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

function releaseResource(release) {
    const { id, releaseId = id, type: _type, meta: _meta, ...attributes } = release;
    return { type: 'Release', id: releaseId, attributes };
}

function paginationParams(request) {
    const { cursor, limit } = request.queryParams ?? {};
    if (Array.isArray(cursor) || Array.isArray(limit)) {
        throw new BadRequestError('Pagination parameters may appear only once.');
    }
    if (limit === undefined) {
        return { cursor };
    }
    const parsedLimit = Number.parseInt(limit, 10);
    if (!/^\d+$/.test(limit) || parsedLimit < 1 || parsedLimit > 100) {
        throw new BadRequestError('limit must be an integer from 1 through 100.');
    }
    return { cursor, limit: parsedLimit };
}

export { paginationParams };
