import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { matchesIfNoneMatch } from './file-response.js';


// Request headers which select a different render of the same URL.
const RENDER_MODE_HEADERS = [ 'kixx-partial', 'kixx-boosted' ];


/**
 * Renders and commits a Hyperview page response.
 *
 * Route defaults are overridden by response rendering options, then by the
 * client-selected partial or boosted render mode. Every response varies on the
 * render mode request headers.
 *
 * Set `responseOptions.cacheControl` to opt a public page into shared caching.
 * A successful GET or HEAD response then carries that Cache-Control value and
 * a strong ETag hashed from the body, and a matching If-None-Match gets a 304
 * without a body. Without it, the router's default `no-store` policy applies.
 *
 * @param {Object} context - Active request context.
 * @param {Object} request - Incoming HTTP request with headers.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response carrying template props and rendering options.
 * @param {Object} [defaultOptions] - Route or caller render defaults; responseOptions remain presentation-only.
 * @param {Object} [defaultOptions.responseOptions] - Options used only when committing the response.
 * @param {string} [defaultOptions.responseOptions.contentType='text/html'] - Hypertext content type.
 * @param {Object} [defaultOptions.responseOptions.headers] - Additional hypertext response headers.
 * @param {string} [defaultOptions.responseOptions.cacheControl] - Cache-Control value for a successful GET or HEAD response.
 * @returns {Promise<import('../../../kixx/http-router/server-response.js').default>} Resolves to the committed response.
 */
export default async function respondWithHyperviewPage(context, request, response, defaultOptions) {
    const options = Object.assign(
        {},
        defaultOptions,
        response.renderingOptions,
    );

    if (request.headers.has('kixx-partial')) {
        options.partial = request.headers.get('kixx-partial');
    }

    if (request.headers.has('kixx-boosted')) {
        options.skipBaseRender = true;
    }

    const { responseOptions: configuredResponseOptions, ...renderOptions } = options;
    const { cacheControl, ...hypertextOptions } = configuredResponseOptions ?? {};
    const responseOptions = {
        ...hypertextOptions,
        contentType: hypertextOptions.contentType ?? 'text/html',
    };

    // An error response is rendered from request-specific state (validation
    // errors, an echoed field value, a one-time notice) that must never be
    // written to the shared rendered-page cache or served to another request.
    // This overrides any route or handler cache configuration; it does not
    // affect compiled-template caching, which stays on regardless.
    if (response.status >= 400) {
        renderOptions.usePageCache = false;
    }
    const hyperviewService = context.getService('HyperviewService');
    const result = await hyperviewService.renderPage(context, {
        ...renderOptions,
        props: response.props,
        url: request.url,
    });

    if (result.type === 'hypertext') {
        response.respondWithUtf8(response.status, result.hypertext, responseOptions);
    } else if (result.type === 'page-context') {
        response.respondWithJSON(response.status, result.pageContext, { whiteSpace: 4 });
    } else {
        throw new TypeError(`Unknown Hyperview render result type: ${ result.type }`);
    }

    // Without Vary, a shared cache or the browser cache would serve whichever
    // render mode it stored first to every request for this URL.
    response.addVary(...RENDER_MODE_HEADERS);

    if (isNonEmptyString(cacheControl) && isRevalidatable(request, response)) {
        await applyCacheValidator(request, response, cacheControl);
    }

    return response;
}

function isRevalidatable(request, response) {
    return response.status === 200 && (request.method === 'GET' || request.method === 'HEAD');
}

async function applyCacheValidator(request, response, cacheControl) {
    const etag = `"${ await sha256Hex(response.body) }"`;

    response.setHeader('cache-control', cacheControl);
    response.setHeader('etag', etag);

    // The Workers Cache revalidates a no-cache entry by invoking the Worker with
    // the stored ETag; a 304 tells it to serve the stored body. The comparison
    // is weak because Cloudflare weakens the ETag when it compresses the body.
    if (matchesIfNoneMatch(request.headers.get('if-none-match'), etag)) {
        response.headers.delete('content-type');
        response.headers.delete('content-length');
        response.respondWithStream(304, null);
    }
}
