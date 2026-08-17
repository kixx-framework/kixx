import { BadRequestError, NotFoundError } from '../../../../kixx/errors/mod.js';
import { statResource as statResourceScript } from '../../../transaction-scripts/publishing/stat-resource.js';
import { JSON_API_CONTENT_TYPE, jsonApiResource } from '../../lib/json-api.js';


const CHECK_PATHNAME_TYPES = [
    'page_metadata',
    'page_partials',
    'page_includes',
    'page_template',
];


export function StatResource(type) {
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
