import { NotFoundError, ValidationError } from '../../../../kixx/errors/mod.js';
import {
    assertArray,
    isString,
    isPlainObject,
    isNonEmptyString,
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
    // TODO: Validate the payload
    return await request.arrayBuffer();
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
    // TODO: Validate the Content-Type as text/plain.
    return await request.text();
});

export const putEmailAssets = putHandlerWithPathname('EmailAssets', async (request) => {
    assertJsonApiContentType(request);
    const { attributes } = await parseJsonApiResource(request, 'EmailAssets');

    const err = new ValidationError('PUT EmailAssets payload validation error');

    // TODO: Validate the attributes according to the rules in HyperviewService#getEmail()

    if (err.length > 0) {
        throw err;
    }

    return attributes;
});


export async function commitChanges(context, request, response) {
    assertJsonApiContentType(request);

    const { attributes } = await parseJsonApiResource(request, 'ContentTree');

    const {
        buildId,
        staticAssets,
        globalTemplatePartials,
        baseTemplates,
        pages,
        emails,
    } = attributes;

    const store = context.getService('ContentAddressableStore');

    const { hash, nodeCount } = await store.commitChanges(context, buildId, {
        staticAssets,
        globalTemplatePartials,
        baseTemplates,
        pages,
        emails,
    });

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
