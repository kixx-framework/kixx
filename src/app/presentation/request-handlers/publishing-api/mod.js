import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    UnsupportedMediaTypeError,
    ValidationError,
} from '../../../../kixx/errors/mod.js';
import {
    assertArray,
    isString,
    isPlainObject,
    isNonEmptyString,
    isUndefined,
} from '../../../../kixx/assertions/mod.js';
import {
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
    parseJsonApiResource,
    assertJsonApiContentType,
} from '../../lib/json-api.js';


function statHandlerWithPathname(type) {

    return async function statHandler(context, request, response) {
        const store = context.getService('ContentAddressableStore');

        // An optional `{/*path}` route group yields undefined, not [], when it
        // doesn't match (e.g. a request for the root pathname).
        const segments = request.pathnameParams.path ?? [];
        assertArray(segments, `Route for ${ request.url.pathname } must produce path segments`);
        const pathname = store.normalizePathname(segments.join('/'));

        const content = await store.openSnapshot(context);
        const stats = content[`stat${ type }`](pathname);

        if (!stats) {
            throw new NotFoundError(`${ type } resource not found at ${ pathname }`);
        }

        const resource = jsonApiResource({
            type,
            id: stats.hash,
            attributes: {
                pathname,
                hash: stats.hash,
                size: stats.size,
                metadata: stats.metadata,
            },
        });

        return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}


function statHandlerWithoutPathname(type) {
    return async function statHandler(context, _request, response) {
        const store = context.getService('ContentAddressableStore');
        const content = await store.openSnapshot(context);
        const stats = content[`stat${ type }`]();

        if (!stats) {
            throw new NotFoundError(`${ type } resource not found`);
        }

        const resource = jsonApiResource({
            type,
            id: stats.hash,
            attributes: {
                hash: stats.hash,
                size: stats.size,
                metadata: stats.metadata,
            },
        });

        return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}


function putHandlerWithPathname(type, getPayload) {

    return async function putHandler(context, request, response) {
        const store = context.getService('ContentAddressableStore');

        // An optional `{/*path}` route group yields undefined, not [], when it
        // doesn't match (e.g. a request for the root pathname).
        const segments = request.pathnameParams.path ?? [];
        assertArray(segments, `Route for ${ request.url.pathname } must produce path segments`);
        const pathname = store.normalizePathname(segments.join('/'));

        const payload = await getPayload(request);

        const content = await store.openSnapshot(context);
        const stats = content[`put${ type }`](context, pathname, payload);

        const resource = jsonApiResource({
            type,
            id: stats.hash,
            attributes: {
                pathname,
                hash: stats.hash,
                size: stats.size,
            },
        });

        return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}


function putHandlerWithoutPathname(type, getPayload) {
    return async function putHandler(context, request, response) {
        const store = context.getService('ContentAddressableStore');

        const payload = await getPayload(request);

        const content = await store.openSnapshot(context);
        const stats = content[`put${ type }`](context, payload);

        const resource = jsonApiResource({
            type,
            id: stats.hash,
            attributes: {
                hash: stats.hash,
                size: stats.size,
            },
        });

        return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}

export const statStaticAsset = statHandlerWithPathname('StaticAsset');
export const statGlobalTemplatePartials = statHandlerWithoutPathname('GlobalTemplatePartials');
export const statBaseTemplates = statHandlerWithoutPathname('BaseTemplates');
export const statPageMetadata = statHandlerWithPathname('PageMetadata');
export const statPageIncludes = statHandlerWithPathname('PageIncludes');
export const statPagePartials = statHandlerWithPathname('PagePartials');
export const statPageTemplate = statHandlerWithPathname('PageTemplate');
export const statEmailAssets = statHandlerWithPathname('EmailAssets');

export const putStaticAsset = putHandlerWithPathname('StaticAsset', async (request) => {
    const payload = await request.arrayBuffer();

    if (payload.byteLength === 0) {
        throw new BadRequestError('PUT StaticAsset payload must not be empty');
    }

    return payload;
});

export const putGlobalTemplatePartials = putHandlerWithoutPathname('GlobalTemplatePartials', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'GlobalTemplatePartials');
    const templates = attributes.bundle;

    const err = new ValidationError('PUT GlobalTemplatePartials payload validation error');

    if (Array.isArray(templates)) {
        for (let i = 0; i < templates.length; i += 1) {
            const { id, source } = templates[i];
            if (!isNonEmptyString(id)) {
                err.push('A partial template must have an id string', `attributes.bundle.${ i }`);
            }
            if (!isNonEmptyString(source)) {
                err.push('A partial template must have a source string', `attributes.bundle.${ i }`);
            }
        }
    } else {
        err.push('The partials bundle must be an Array', 'attributes.bundle');
    }

    if (err.length > 0) {
        throw err;
    }

    return templates;
});

export const putBaseTemplates = putHandlerWithoutPathname('BaseTemplates', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'BaseTemplates');
    const templates = attributes.bundle;

    const err = new ValidationError('PUT BaseTemplates payload validation error');

    if (Array.isArray(templates)) {
        for (let i = 0; i < templates.length; i += 1) {
            const { id, source } = templates[i];
            if (!isNonEmptyString(id)) {
                err.push('A template must have an id string', `attributes.bundle.${ i }`);
            }
            if (!isNonEmptyString(source)) {
                err.push('A template must have a source string', `attributes.bundle.${ i }`);
            }
        }
    } else {
        err.push('The templates bundle must be an Array', 'attributes.bundle');
    }

    if (err.length > 0) {
        throw err;
    }

    return templates;
});

export const putPageMetadata = putHandlerWithPathname('PageMetadata', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'PageMetadata');
    return attributes;
});

export const putPageIncludes = putHandlerWithPathname('PageIncludes', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'PageIncludes');
    const includes = attributes.bundle;

    const err = new ValidationError('PUT PageIncludes payload validation error');

    if (isPlainObject(includes)) {
        for (const key of Object.keys(includes)) {
            if (!isString(includes[key])) {
                err.push('A page include may only contain text content', `attributes.bundle.${ key }`);
            }
        }
    } else {
        err.push('The includes bundle must be a plain Object', 'attributes.bundle');
    }

    if (err.length > 0) {
        throw err;
    }

    return includes;
});

export const putPagePartials = putHandlerWithPathname('PagePartials', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'PagePartials');
    const templates = attributes.bundle;

    const err = new ValidationError('PUT PagePartials payload validation error');

    if (Array.isArray(templates)) {
        for (let i = 0; i < templates.length; i += 1) {
            const { id, source } = templates[i];
            if (!isNonEmptyString(id)) {
                err.push('A partial template must have an id string', `attributes.bundle.${ i }`);
            }
            if (!isNonEmptyString(source)) {
                err.push('A partial template must have a source string', `attributes.bundle.${ i }`);
            }
        }
    } else {
        err.push('The partials bundle must be an Array', 'attributes.bundle');
    }

    if (err.length > 0) {
        throw err;
    }

    return templates;
});

export const putPageTemplate = putHandlerWithPathname('PageTemplate', async (request) => {
    if (request.getContentMediaType() !== 'text/plain') {
        throw new UnsupportedMediaTypeError(
            'Request Content-Type must be text/plain.',
            { accept: [ 'text/plain' ] },
        );
    }

    return await request.text();
});

export const putEmailAssets = putHandlerWithPathname('EmailAssets', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'EmailAssets');

    const err = new ValidationError('PUT EmailAssets payload validation error');

    // Mirrors the shape HyperviewService#getEmail() reads back out of this bundle.
    const { htmlTemplate, textTemplate, partials, includes } = attributes;

    if (!isUndefined(htmlTemplate)) {
        validateEmailTemplate(err, htmlTemplate, 'attributes.htmlTemplate', 'HTML template');
    }

    if (!isUndefined(textTemplate)) {
        validateEmailTemplate(err, textTemplate, 'attributes.textTemplate', 'text template');
    }

    if (!isUndefined(partials)) {
        if (Array.isArray(partials)) {
            partials.forEach((partial, i) => {
                validateEmailTemplate(err, partial, `attributes.partials.${ i }`, 'partial');
            });
        } else {
            err.push('The partials must be an Array', 'attributes.partials');
        }
    }

    if (!isUndefined(includes)) {
        if (isPlainObject(includes)) {
            for (const key of Object.keys(includes)) {
                if (!isString(includes[key])) {
                    err.push('An email include may only contain text content', `attributes.includes.${ key }`);
                }
            }
        } else {
            err.push('The includes must be a plain Object', 'attributes.includes');
        }
    }

    if (err.length > 0) {
        throw err;
    }

    return attributes;
});

function validateEmailTemplate(err, template, source, label) {
    if (!isPlainObject(template)) {
        err.push(`A ${ label } must be a plain Object`, source);
        return;
    }

    if (!isNonEmptyString(template.id)) {
        err.push(`A ${ label } must have an id string`, `${ source }.id`);
    }
    if (!isNonEmptyString(template.source)) {
        err.push(`A ${ label } must have a source string`, `${ source }.source`);
    }
}


export async function commitChanges(context, request, response) {
    assertJsonApiContentType(request);

    const { attributes } = await parseJsonApiResource(request, 'ContentTree');

    const {
        buildId,
        expectedRootHash,
        staticAssets,
        globalTemplatePartials,
        baseTemplates,
        pages,
        emails,
    } = attributes;

    if (!isUndefined(expectedRootHash) && !isNonEmptyString(expectedRootHash)) {
        const err = new ValidationError('PUT ContentTree payload validation error');
        err.push('expectedRootHash must be a non-empty string when present', 'attributes.expectedRootHash');
        throw err;
    }

    const store = context.getService('ContentAddressableStore');

    const { hash, nodeCount } = await store.commitChanges(context, buildId, {
        staticAssets,
        globalTemplatePartials,
        baseTemplates,
        pages,
        emails,
    }, { expectedRootHash });

    const resource = jsonApiResource({
        type: 'ContentTree',
        id: hash,
        attributes: {
            buildId,
            hash,
            nodeCount,
        },
    });

    return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
}


/**
 * Reports the running deploy's build id and its currently assigned closure.
 * @param {Object} context - Request context exposing the ContentAddressableStore service and runtime build id
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} _request - Unused; the resource is derived entirely from context.runtime.build.id
 * @param {import('../../../../kixx/http-router/server-response-interface.js').ServerResponseInterface} response - Response to write the Build resource onto
 * @returns {Promise<Object>} The response, carrying a 200 Build resource
 * @throws {NotFoundError} When the runtime has no build id or the build has no assigned closure
 */
export async function getBuild(context, _request, response) {
    const store = context.getService('ContentAddressableStore');
    const build = await store.getCurrentBuild(context);

    if (!build) {
        throw new NotFoundError('No active build is configured.');
    }

    const resource = jsonApiResource({
        type: 'Build',
        id: build.id,
        attributes: { rootHash: build.rootHash },
    });

    return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
}


/**
 * Conditionally points the running deploy's build at an already-published
 * closure. This never publishes new content and can only ever move the
 * running build's own pointer — `data.id` is checked against it, not used to
 * select which build to mutate.
 * @param {Object} context - Request context exposing the ContentAddressableStore service and runtime build id
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request carrying a Build resource document
 * @param {import('../../../../kixx/http-router/server-response-interface.js').ServerResponseInterface} response - Response to write the resulting Build resource onto
 * @returns {Promise<Object>} The response, carrying a 200 Build resource
 * @throws {ValidationError} When `attributes.rootHash` or `attributes.expectedRootHash` is not a non-empty string
 * @throws {NotFoundError} When the runtime has no build id, or `rootHash` names no saved closure
 * @throws {ConflictError} When `data.id` does not match the running build (code `BuildIdMismatch`), or the build's current pointer no longer matches `expectedRootHash` (code `BuildPointerConflict`)
 */
export async function putBuild(context, request, response) {
    assertJsonApiContentType(request);

    const { id, attributes } = await parseJsonApiResource(request, 'Build');
    const { rootHash, expectedRootHash } = attributes;

    const err = new ValidationError('PUT Build payload validation error');
    if (!isNonEmptyString(rootHash)) {
        err.push('rootHash must be a non-empty string', 'attributes.rootHash');
    }
    if (!isNonEmptyString(expectedRootHash)) {
        err.push('expectedRootHash must be a non-empty string', 'attributes.expectedRootHash');
    }
    if (err.length > 0) {
        throw err;
    }

    const runtimeBuildId = context.runtime.build.id ?? null;

    if (!runtimeBuildId) {
        throw new NotFoundError('No active build is configured.');
    }

    // The endpoint only ever operates on the running deploy's own build;
    // a mismatched id is rejected here rather than silently ignored, so a
    // caller cannot mistake this for pointing an arbitrary build.
    if (id !== runtimeBuildId) {
        throw new ConflictError(
            `Build id "${ id }" does not match the running build "${ runtimeBuildId }".`,
            { code: 'BuildIdMismatch' },
        );
    }

    const store = context.getService('ContentAddressableStore');
    const build = await store.assignCurrentBuild(context, { rootHash, expectedRootHash });

    const resource = jsonApiResource({
        type: 'Build',
        id: build.id,
        attributes: { rootHash: build.rootHash },
    });

    return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
}
