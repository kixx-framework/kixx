import { BadRequestError, NotFoundError } from '../../../../kixx/errors/mod.js';
import { assert } from '../../../../kixx/assertions/mod.js';
import {
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
    parseJsonApiResource,
    assertJsonApiContentType,
} from '../../lib/json-api.js';


// The six Hyperview content resources this API exposes, keyed by their
// canonical external identifier. `HyperviewContentService` and its layout
// module assert their own path preconditions but do not translate bad client
// input into operational errors, so every request handler below validates the
// request's path against the resource's exact `pathKind` before calling the
// service; that is what turns a malformed client path into a BadRequestError
// instead of an internal AssertionError.
//
// `pathKind` is one of:
//   'none'              - no wildcard path segment (the two bundle resources).
//   'page-path'         - route pattern `{/*path}`; the root page is
//                         meaningful, so a single empty segment folds to '/'.
//   'template-filepath' - route pattern `/*path`; must name a file, so the
//                         root fold must NOT apply. The generic page-path rule
//                         accepts '/', while the filepath rule rejects it;
//                         reusing the page-path branch would let a
//                         `/page-templates/` request resolve to '/' and map
//                         onto the /pages namespace root instead of a real
//                         file.
const RESOURCE_CATALOG = Object.freeze({
    template_partials: Object.freeze({
        pathKind: 'none',
        bodyFormat: 'json',
        stat: (contentService, context) => contentService.statTemplatePartials(context),
        put: (contentService, context, _pathname, payload, etag) => contentService.putTemplatePartials(context, { bundle: payload, etag }),
    }),
    base_templates: Object.freeze({
        pathKind: 'none',
        bodyFormat: 'json',
        stat: (contentService, context) => contentService.statBaseTemplates(context),
        put: (contentService, context, _pathname, payload, etag) => contentService.putBaseTemplates(context, { bundle: payload, etag }),
    }),
    page_metadata: Object.freeze({
        pathKind: 'page-path',
        bodyFormat: 'json',
        stat: (contentService, context, pathname) => contentService.statPageMetadata(context, pathname),
        put: (contentService, context, pathname, payload, etag) => contentService.putPageMetadata(context, { pathname, metadata: payload, etag }),
    }),
    page_partials: Object.freeze({
        pathKind: 'page-path',
        bodyFormat: 'json',
        stat: (contentService, context, pathname) => contentService.statPagePartials(context, pathname),
        put: (contentService, context, pathname, payload, etag) => contentService.putPagePartials(context, { pathname, bundle: payload, etag }),
    }),
    page_includes: Object.freeze({
        pathKind: 'page-path',
        bodyFormat: 'json',
        stat: (contentService, context, pathname) => contentService.statPageIncludes(context, pathname),
        put: (contentService, context, pathname, payload, etag) => contentService.putPageIncludes(context, { pathname, bundle: payload, etag }),
    }),
    page_templates: Object.freeze({
        pathKind: 'template-filepath',
        bodyFormat: 'text',
        stat: (contentService, context, filepath) => contentService.statPageTemplate(context, filepath),
        put: (contentService, context, filepath, payload, etag) => contentService.putPageTemplate(context, { filepath, source: payload, etag }),
    }),
});

// An unregistered type is a route-configuration bug, not client input, so it
// asserts rather than producing a request error.
function getCatalogEntry(type) {
    const entry = RESOURCE_CATALOG[type];
    assert(entry, `Unknown Publishing API resource type "${ type }"`);
    return entry;
}

function resolvePathname(contentService, entry, type, handlerName, request) {
    if (entry.pathKind === 'none') {
        return undefined;
    }

    // Optional wildcard route groups (`{/*path}`) match the bare route with a
    // single empty segment; a plain wildcard (`/*path`) never produces one.
    const segments = request.pathnameParams.path;
    if (!Array.isArray(segments)) {
        throw new BadRequestError(
            `${ handlerName } ${ type } requires a path`,
            { code: 'PagePathRequired' },
        );
    }

    let pathname;
    if (entry.pathKind === 'page-path' && segments.length === 1 && segments[0] === '') {
        pathname = '/';
    } else {
        pathname = contentService.normalizePathname(segments.join('/'));
    }

    const isValid = entry.pathKind === 'template-filepath'
        ? contentService.isValidTemplateFilepath(pathname)
        : contentService.isValidPathname(pathname);

    if (!isValid) {
        throw new BadRequestError(
            `Invalid path "${ pathname }" passed to ${ handlerName } ${ type }`,
            { code: 'InvalidPagePath' },
        );
    }

    return pathname;
}

export function StatResource({ type }) {
    const entry = getCatalogEntry(type);

    return async function statResource(context, request, response) {
        const contentService = context.getService('HyperviewContent');
        const pathname = resolvePathname(contentService, entry, type, 'StatResource', request);

        const stats = await entry.stat(contentService, context, pathname);

        if (!stats) {
            const message = pathname
                ? `${ type } resource not found from ${ pathname }`
                : `${ type } resource not found`;
            throw new NotFoundError(message);
        }

        const resource = jsonApiResource({
            type,
            id: pathname,
            attributes: stats,
        });

        return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}

export function PutResource({ type }) {
    const entry = getCatalogEntry(type);

    return async function putResource(context, request, response) {
        const contentService = context.getService('HyperviewContent');
        const pathname = resolvePathname(contentService, entry, type, 'PutResource', request);

        const payload = entry.bodyFormat === 'text' ? await request.text() : await request.json();
        const etag = request.headers.get('x-checksum');

        const stats = await entry.put(contentService, context, pathname, payload, etag);

        const resource = jsonApiResource({
            type,
            id: pathname,
            attributes: stats,
        });

        return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}

export function CommitChanges() {
    return async function commitChanges(context, request, response) {
        assertJsonApiContentType(request);

        const { attributes } = await parseJsonApiResource(request, 'ContentTree');

        const {
            buildId,
            templatePartials,
            baseTemplates,
            pageMetadata,
            pagePartials,
            pageIncludes,
            pageTemplates,
        } = attributes;

        const contentService = context.getService('HyperviewContent');

        const { hash, count } = await contentService.commitChanges(context, {
            buildId,
            manifest: {
                templatePartials,
                baseTemplates,
                pageMetadata,
                pagePartials,
                pageIncludes,
                pageTemplates,
            },
        });

        const resource = jsonApiResource({
            type: 'ContentTree',
            id: hash,
            attributes: {
                hash,
                nodeCount: count,
            },
        });

        return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}
