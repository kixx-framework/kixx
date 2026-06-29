import { BadRequestError } from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    jsonApiResource,
} from '../../lib/json-api.js';
import { assertPublishingPermission } from '../../middleware/publishing-authentication.js';
import { bufferRequestBodyWithLimit } from '../../lib/read-request-body.js';
import { putStaticAsset as putStaticAssetScript } from '../../../transaction-scripts/publishing/put-static-asset.js';
import validatePathname from '../../../../kixx/utils/validate-pathname.js';


// Cloudflare KV values cap at 25 MiB; stay safely under that so the metadata
// written alongside the bytes never pushes a stored value over the limit. The
// handler enforces this before buffering so an oversized upload is rejected (413)
// without reading the whole body into memory.
const MAX_ASSET_BYTES = 24 * 1024 * 1024;


export async function putStaticAsset(context, request, response) {
    const filepath = getWildcardFilepath(request, 'filepath');

    // Asset writes are gated by a single coarse-grained capability: a token either
    // may write assets or it may not. The decision depends on neither the filepath
    // nor the build, so it runs before the request body is read — an unauthorized
    // token gets a 403 rather than having its (possibly large) upload buffered.
    assertPublishingPermission(context, {
        action: 'urn:kixx:publishing:asset:put',
        resource: 'urn:kixx:publishing:asset',
    });

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

function getWildcardFilepath(request, name) {
    const segments = request.pathnameParams[name];

    if (!Array.isArray(segments) || segments.length === 0) {
        throw new BadRequestError('Static asset filepath is required.', {
            code: 'StaticAssetFilepathRequired',
        });
    }

    // Reject path traversal and out-of-whitelist characters at the edge (400)
    // rather than relying on a downstream store assertion (500).
    return validatePathname(segments.join('/'));
}
