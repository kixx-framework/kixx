import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ValidationError,
} from '../../../../kixx/errors/mod.js';
import { hashBlob } from '../../../../kixx/content-addressable-store/addressing.js';
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
import { MAX_INLINE_CONTENT_BYTES, MAX_MANIFEST_ENTRIES } from './constants.js';


/**
 * Creates and fully verifies a Release.
 * @param {Object} context - Authenticated request context.
 * @param {Object} request - JSON:API Release request.
 * @param {Object} response - Response to populate.
 * @returns {Promise<Object>} Created JSON:API Release response.
 */
export async function createRelease(context, request, response) {
    const attributes = await parseReleaseRequest(request);
    const manifest = await prepareInlineContent(context, attributes.manifest);

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
    const manifest = await prepareInlineContent(context, attributes.manifest, { persist: false });
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

async function prepareInlineContent(context, manifest, options) {
    const { persist = true } = options ?? {};
    const transformed = structuredClone(manifest);
    const inlineState = { objects: [], totalBytes: 0 };
    await replaceInlineReferences(transformed, inlineState);
    const files = validateReleaseManifest(transformed);
    if (files.length > MAX_MANIFEST_ENTRIES) {
        throw new BadRequestError(`A Release may contain at most ${ MAX_MANIFEST_ENTRIES } manifest entries.`);
    }

    if (!persist && inlineState.objects.length > 0) {
        throw new BadRequestError('Inline content is accepted only when creating a Release.');
    }

    const store = context.getService('ContentAddressableStore');
    for (const object of inlineState.objects) {
        await store.putObject(context, object.payload);
    }
    return transformed;
}

async function replaceInlineReferences(value, inlineState) {
    if (Array.isArray(value)) {
        for (const item of value) {
            await replaceInlineReferences(item, inlineState);
        }
        return;
    }
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
        return;
    }

    const keys = Object.keys(value);
    const isInlineReference = Object.hasOwn(value, 'content') &&
        keys.every((key) => key === 'content' || key === 'mediaType');
    if (isInlineReference) {
        if (typeof value.content !== 'string') {
            throw releaseValidationError('Inline content must be a string', 'InvalidReleaseManifest', 'content');
        }
        const payload = new TextEncoder().encode(value.content);
        inlineState.totalBytes += payload.byteLength;
        if (inlineState.totalBytes > MAX_INLINE_CONTENT_BYTES) {
            throw new BadRequestError(`Inline content exceeds the ${ MAX_INLINE_CONTENT_BYTES } byte limit.`);
        }
        const objectId = await hashBlob(payload.buffer);
        const mediaType = value.mediaType;
        for (const key of keys) {
            delete value[key];
        }
        Object.assign(value, { objectId, size: payload.byteLength });
        if (mediaType) {
            value.mediaType = mediaType;
        }
        inlineState.objects.push({ objectId, payload: payload.buffer });
        return;
    }

    for (const child of Object.values(value)) {
        await replaceInlineReferences(child, inlineState);
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

function releaseValidationError(message, code, source) {
    const error = new ValidationError(message, { code });
    error.push(message, source);
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
