import { ConflictError, BadRequestError } from '../errors/mod.js';
import { assert, isNonEmptyString } from '../assertions/mod.js';

import validatePathname from './validate-pathname.js';


/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('../http-router/server-request-interface.js').ServerRequestInterface} ServerRequestInterface
 */

/**
 * @typedef {import('../http-router/server-response.js').default} ServerResponse
 */


// Maps the public template type to its HyperviewService write method. All three
// methods share the (context, buildId, filepath, source) signature and resolve
// with the logical { filepath } that was written, so the handler body is
// agnostic to which one it calls.
const WRITE_METHOD_BY_TEMPLATE_TYPE = {
    base: 'putBaseTemplate',
    page: 'putPageTemplate',
    partial: 'putPartial',
};


/**
 * Creates a request handler that uploads a single Hyperview template to a target
 * build, writing the raw request body through the HyperviewService write methods.
 *
 * The handler is RESTful: the URL is the template's logical address. The target
 * build id comes from the route's `:buildId` named param, the template filepath
 * from the route's `*path` wildcard param, and the raw request body is the
 * template source. A successful upload responds `200` with the logical
 * `{ filepath }` that was written.
 *
 * The handler performs no authentication; compose the route with an upstream auth
 * guard, since uploading templates is a privileged operation. Note that when no
 * current build id is configured the underlying service rejects with an
 * `AssertionError` (a 500), because template writes require a current build to
 * exist; bootstrapping the first build happens through another mechanism.
 *
 * @param {Object} options - Handler configuration
 * @param {'base'|'page'|'partial'} options.templateType - Which kind of template this handler writes
 * @returns {function(RequestContext, ServerRequestInterface, ServerResponse): Promise<ServerResponse>}
 *   Async request handler for the router pipeline. The handler throws
 *   `BadRequestError` (400) for a missing/unsafe filepath or an empty body, and
 *   `ConflictError` (409) when the target build id equals the current build id.
 * @throws {AssertionError} When `options.templateType` is not one of `base`, `page`, or `partial`
 */
export function HyperviewTemplateUploadHandler(options) {
    options = options ?? {};

    const writeMethodName = WRITE_METHOD_BY_TEMPLATE_TYPE[options.templateType];
    assert(
        writeMethodName,
        `HyperviewTemplateUploadHandler options.templateType must be one of: ${ Object.keys(WRITE_METHOD_BY_TEMPLATE_TYPE).join(', ') }`,
    );

    return async function hyperviewTemplateUploadHandler(context, request, response) {
        const { buildId, path: pathSegments } = request.pathnameParams;

        // The `*path` wildcard param is an array of matched path segments; join
        // it back into the logical filepath relative to the type's store prefix.
        const filepath = Array.isArray(pathSegments) ? pathSegments.join('/') : '';

        if (!isNonEmptyString(filepath)) {
            throw new BadRequestError('A template filepath is required');
        }

        // Reuse the shared path-safety rule (rejects `..`, `//`, leading-dot
        // segments, and disallowed characters).
        validatePathname(filepath);

        // Translate an attempt to write the live build into a 409 at the HTTP
        // boundary, before reading the body so we fail fast. The service guard
        // still enforces this rule as a non-HTTP backstop (AssertionError).
        const currentBuildId = context.runtime.build?.id ?? null;
        if (buildId === currentBuildId) {
            throw new ConflictError(
                `Cannot upload templates to the current build id "${ buildId }"; target a different build`,
            );
        }

        const source = await request.text();

        if (!isNonEmptyString(source) || source.trim().length === 0) {
            throw new BadRequestError('Template source must not be empty');
        }

        const service = context.getService('Hyperview');
        const ref = await service[writeMethodName](context, buildId, filepath, source);

        return response.respondWithJSON(200, ref, { whiteSpace: 4 });
    };
}
