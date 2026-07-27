import { BadRequestError } from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { bufferRequestBodyWithLimit } from '../../lib/read-request-body.js';
import { getWildcardFilepath } from './route-params.js';
import { putStaticAsset as putStaticAssetScript } from '../../../transaction-scripts/publishing/put-static-asset.js';


// Cloudflare KV values cap at 25 MiB; stay safely under that so the metadata
// written alongside the bytes never pushes a stored value over the limit. The
// handler enforces this before buffering so an oversized upload is rejected (413)
// without reading the whole body into memory.
const MAX_ASSET_BYTES = 24 * 1024 * 1024;

const ASSET_FILEPATH_OPTIONS = {
    label: 'Static asset filepath',
    requiredCode: 'StaticAssetFilepathRequired',
};


/**
 * Writes a static asset's bytes for a build.
 *
 * The client must declare the asset's media type; it is never inferred from the
 * file extension. The write is namespaced by the `x-kixx-build-id` request
 * header, so it lands in the pending build rather than the live one.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request; the body is the asset's bytes.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 200 response describing the stored asset.
 * @throws {BadRequestError} When the wildcard filepath is invalid, or no Content-Type was declared.
 * @throws {PayloadTooLargeError} When the body exceeds the 24 MiB asset limit.
 */
export async function putStaticAsset(context, request, response) {
    const filepath = getWildcardFilepath(request, 'filepath', ASSET_FILEPATH_OPTIONS);

    // Authorization already ran in requireAssetPermission (route head).

    // buildId is validated downstream by putStaticAsset(), which is the single
    // authority that enforces it (required, and must differ from the current build).
    const buildId = request.headers.get(BUILD_ID_HEADER);

    // A static asset is arbitrary binary, so the client must declare its media
    // type; we never infer it from the extension here. A missing Content-Type is a
    // malformed request (400), not an unsupported media type (415).
    const contentType = request.getContentMediaType();
    if (!contentType) {
        throw new BadRequestError('A Content-Type header is required for static asset writes.', {
            code: 'ContentTypeRequired',
        });
    }

    const body = await bufferRequestBodyWithLimit(request, MAX_ASSET_BYTES);
    const written = await putStaticAssetScript(context, {
        filepath,
        body,
        contentType,
        buildId,
    });

    // This target's chain has no Hyperview handler after it, so the committed JSON
    // response is terminal without skip(). Returning normally lets any route
    // outbound middleware (e.g. response formatting) still run.
    return response.respondWithJSON(
        200,
        jsonApiResource({
            type: 'StaticAsset',
            id: written.filepath,
            attributes: {
                filepath: written.filepath,
                buildId: written.buildId,
                contentType: written.contentType,
                contentLength: written.contentLength,
                etag: written.etag,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}
