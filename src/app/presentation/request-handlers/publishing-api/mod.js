import { BadRequestError, NotFoundError } from '../../../../kixx/errors/mod.js';
import {
    statResource as statResourceScript,
    putResource as putResourceScript,
    commitChanges as commitChangesScript,
} from '../../../transaction-scripts/publishing/mod.js';
import {
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
    parseJsonApiResource,
    assertJsonApiContentType,
} from '../../lib/json-api.js';


const CHECK_PATHNAME_TYPES = [
    'page_metadata',
    'page_partials',
    'page_includes',
    'page_template',
];

const TEXT_PAYLOAD_TYPES = [
    'page_template',
];


export function StatResource({ type }) {
    const validatePathname = CHECK_PATHNAME_TYPES.includes(type);

    return async function statResource(context, request, response) {
        let pathname;

        if (validatePathname) {
            const store = context.getService('ContentAddressableStore');
            const segments = request.pathnameParams.path;
            if (!Array.isArray(segments)) {
                throw new BadRequestError(
                    `StatResource ${ type } requires a path`,
                    { code: 'PagePathRequired' },
                );
            }

            if (segments.length === 1 && segments[0] === '') {
                pathname = '/';
            } else {
                pathname = store.normalizePathname(segments.join('/'));
            }

            if (!store.isValidPathname(pathname)) {
                throw new BadRequestError(
                    `Invalid path "${ pathname }" passed to StatResource ${ type }`,
                    { code: 'InvalidPagePath' },
                );
            }
        }

        const stats = await statResourceScript(context, type, pathname);

        if (!stats) {
            const message = pathname
                ? `${ type } resource not found from ${ pathname }`
                : `${ type } resource not found`;
            throw new NotFoundError(message);
        }

        const resource = jsonApiResource({
            type,
            id: stats.pathname,
            attributes: stats,
        });

        return response.respondWithJSON(200, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}

export function PutResource({ type }) {
    const validatePathname = CHECK_PATHNAME_TYPES.includes(type);
    const textPayload = TEXT_PAYLOAD_TYPES.includes(type);

    return async function putResource(context, request, response) {
        let payload;
        if (textPayload) {
            payload = await request.text();
        } else {
            payload = await request.json();
        }

        const etag = request.headers.get('x-checksum');

        let pathname;

        if (validatePathname) {
            const store = context.getService('ContentAddressableStore');
            const segments = request.pathnameParams.path;
            if (!Array.isArray(segments)) {
                throw new BadRequestError(
                    `PutResource ${ type } requires a path`,
                    { code: 'PagePathRequired' },
                );
            }

            if (segments.length === 1 && segments[0] === '') {
                pathname = '/';
            } else {
                pathname = store.normalizePathname(segments.join('/'));
            }

            if (!store.isValidPathname(pathname)) {
                throw new BadRequestError(
                    `Invalid path "${ pathname }" passed to PutResource ${ type }`,
                    { code: 'InvalidPagePath' },
                );
            }
        }

        const stats = await putResourceScript(context, type, pathname, payload, etag);

        const resource = jsonApiResource({
            type,
            id: stats.pathname,
            attributes: stats,
        });

        return response.respondWithJSON(201, resource, { contentType: JSON_API_CONTENT_TYPE });
    };
}

export function CommitChanges() {
    return async function commitChanges(context, request, response) {
        assertJsonApiContentType(request);

        const { attributes } = parseJsonApiResource(request, 'ContentTree');

        const {
            buildId,
            templatePartials,
            baseTemplates,
            pageMetadata,
            pagePartials,
            pageIncludes,
            pageTemplates,
        } = attributes;

        const { hash, count } = await commitChangesScript(context, buildId, {
            templatePartials,
            baseTemplates,
            pageMetadata,
            pagePartials,
            pageIncludes,
            pageTemplates,
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
