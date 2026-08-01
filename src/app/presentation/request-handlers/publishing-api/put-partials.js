import { isNonEmptyString, isUndefined } from '../../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    ConflictError,
    PayloadTooLargeError,
} from '../../../../kixx/errors/mod.js';
import {
    BUILD_ID_HEADER,
    JSON_API_CONTENT_TYPE,
    assertJsonApiContentType,
    jsonApiResource,
    resourceFromJsonApiDocument,
} from '../../lib/json-api.js';
import { bufferRequestBodyWithLimit } from '../../lib/read-request-body.js';
import PutPartialsForm from '../../forms/templates/put-partials-form.js';
import { putPartials as putPartialsScript } from '../../../transaction-scripts/publishing/put-partials.js';


const RESOURCE_TYPE = 'PartialTemplateSet';

// Cloudflare KV values cap at 25 MiB; the whole manifest write must stay under
// that limit, not each partial individually.
const MAX_PARTIALS_BYTES = 25 * 1024 * 1024;

const CONTENT_LENGTH_HEADER = 'content-length';
const DECIMAL_DIGITS_PATTERN = /^[0-9]+$/u;

const textDecoder = new TextDecoder('utf-8', { fatal: true });


/**
 * Replaces the complete partial template set for a build.
 *
 * This is the only partial-publishing endpoint: it always replaces the entire
 * set for the target build in one request rather than writing one partial at a
 * time. The write is namespaced by the `x-kixx-build-id` request header, so it
 * lands in the pending build rather than the live one.
 *
 * `Content-Length` is required and checked before any body is read; a missing,
 * malformed, or oversized declaration is rejected without buffering. The
 * declared length is a fast rejection path only — `bufferRequestBodyWithLimit()`
 * still enforces the same cap against bytes actually streamed, so an understated
 * declaration cannot bypass it.
 *
 * @param {import('../../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {import('../../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request; the body is a JSON:API `PartialTemplateSet` document.
 * @param {import('../../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {Promise<import('../../../../kixx/http-router/server-response.js').default>} 200 response summarizing the written partial set.
 * @throws {UnsupportedMediaTypeError} When the request Content-Type is not `application/vnd.api+json`.
 * @throws {BadRequestError} When Content-Length is missing/malformed, the body is not valid JSON:API, or an entry fails validation.
 * @throws {PayloadTooLargeError} When the declared or actual body size exceeds 25 MiB.
 * @throws {ConflictError} When `data.id` does not match `partials/<buildId>`, or the resource type does not match.
 */
export async function putPartials(context, request, response) {
    assertJsonApiContentType(request);
    assertDeclaredContentLength(request);

    // Authorization already ran in requireTemplatePermission (route head).

    // buildId is validated downstream by the Transaction Script, which is the
    // single authority that enforces it (required, valid, and must differ from
    // the current build).
    const buildId = request.headers.get(BUILD_ID_HEADER);

    const bodyBytes = await bufferRequestBodyWithLimit(request, MAX_PARTIALS_BYTES);
    const document = decodeJsonBody(bodyBytes);
    const resource = resourceFromJsonApiDocument(document, RESOURCE_TYPE);

    assertResourceIdentity(resource, buildId);

    const form = PutPartialsForm.fromJsonApi(resource);
    form.validate();

    const written = await putPartialsScript(context, {
        buildId,
        partials: form.toJSON().partials,
    });

    // This target's chain has no Hyperview handler after it, so the committed
    // JSON response is terminal without skip(). Returning normally lets any
    // route outbound middleware (e.g. response formatting) still run.
    return response.respondWithJSON(
        200,
        jsonApiResource({
            type: RESOURCE_TYPE,
            id: `partials/${ buildId }`,
            attributes: {
                buildId,
                partials: written,
            },
        }),
        { contentType: JSON_API_CONTENT_TYPE },
    );
}

// Declared Content-Length is a fast rejection path: reject a missing,
// non-numeric, or oversized declaration before buffering anything.
// bufferRequestBodyWithLimit() below remains the authoritative cap against
// bytes actually streamed, since a client's declared length is not trustworthy.
function assertDeclaredContentLength(request) {
    const raw = request.headers.get(CONTENT_LENGTH_HEADER);

    if (!isNonEmptyString(raw)) {
        throw new BadRequestError('A Content-Length header is required for partial template set writes.', {
            code: 'ContentLengthRequired',
            httpStatusCode: 411,
        });
    }

    if (!DECIMAL_DIGITS_PATTERN.test(raw)) {
        throw new BadRequestError('Content-Length must be a non-negative integer.', {
            code: 'ContentLengthInvalid',
        });
    }

    const declaredLength = Number.parseInt(raw, 10);

    if (declaredLength > MAX_PARTIALS_BYTES) {
        throw new PayloadTooLargeError(
            `Partial template set request body exceeds the maximum of ${ MAX_PARTIALS_BYTES } bytes.`,
        );
    }
}

// Mirrors the BadRequestError contract of ServerRequestInterface#json(), since
// the body must be decoded from already-buffered bytes here instead of through
// request.json() (the byte cap must be enforced before JSON parsing).
function decodeJsonBody(bodyBytes) {
    try {
        return JSON.parse(textDecoder.decode(bodyBytes));
    } catch (cause) {
        throw new BadRequestError('Invalid JSON in request body', { cause });
    }
}

function assertResourceIdentity(resource, buildId) {
    if (isUndefined(resource.id)) {
        return;
    }

    const expectedId = `partials/${ buildId }`;

    if (resource.id !== expectedId) {
        throw new ConflictError(`JSON:API resource id must be ${ expectedId }.`, {
            code: 'JsonApiResourceIdMismatch',
        });
    }
}
