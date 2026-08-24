import { isPlainObject } from '../../../../kixx/assertions/mod.js';


/**
 * Creates the request handler which renders a Hyperview page as the response.
 *
 * This is the adapter between an HTTP route target and
 * {@link HyperviewService#respondWithHypertext}. It owns one decision and
 * nothing else: which render options apply to this request. The rendering
 * itself, the page lookup, and both caches belong to the HyperviewService.
 *
 * ## Using it in a route
 * Place it last in a target's `requestHandlers` chain. Earlier handlers read the
 * request, call Transaction Scripts, and hand render data forward with
 * `response.updateProps()`; this handler turns what they accumulated into
 * hypertext.
 *
 * ```js
 * {
 *     name: 'show',
 *     pattern: '/bugs/:id',
 *     methods: [ 'GET', 'HEAD' ],
 *     requestHandlers: [ getBug, HyperviewPageHandler({ pathname: '/bugs/detail' }) ],
 * }
 * ```
 *
 * Pass `pathname` whenever the route pattern contains dynamic segments. Without
 * it the page is looked up by the request pathname, so `/bugs/BUG-123` would
 * need its own `pages/` and `templates/pages/` directories. A stable `pathname`
 * points every request at one published page.
 *
 * A handler with no options renders the page published at the request pathname,
 * which is what the catch-all (`"*"`) target wants for content-only pages.
 *
 * ## Where the options come from
 * Three sources are merged, later sources winning over earlier ones:
 *
 * 1. `defaultOptions` — the route's own configuration, fixed at startup.
 * 2. `response.props.hyperviewOptions` — a per-request override set by an
 *    earlier handler through `response.updateProps()`. Merged key by key, so an
 *    override object replaces only the options it names. Use it when the render
 *    mode depends on what the request handler found, not on the route.
 * 3. The `kixx-partial` and `kixx-boosted` request headers — the render mode
 *    the client asked for. These win over both, because only the client knows
 *    whether it is replacing a fragment, swapping a page body, or loading a
 *    document.
 *
 * ## The render mode the client asks for
 * The same page serves three granularities, selected by request header:
 *
 * - `kixx-partial: <partial-id>` renders that page partial alone, for a browser
 *   replacing a fragment of the current document in place.
 * - `kixx-boosted` renders the page template without its base template, for a
 *   browser swapping the body during a page transition.
 * - Neither header renders the complete document, wrapping the page template in
 *   the base template named by `baseTemplateId`.
 *
 * A full-page render therefore requires `baseTemplateId`; the other two modes
 * ignore it. Because the headers are checked last, an untrusted client can pick
 * any of the three modes for a route, but it cannot reach a page or a partial
 * the route did not already publish — the HyperviewService validates both
 * identifiers and renders only what the resolved page contains.
 *
 * ## What the handler does not decide
 * The response status is whatever an earlier handler set, so a re-rendered
 * validation error keeps its 4xx. Runtime values reach the template through
 * `response.props`, which the assembled page context merges over the page's
 * published metadata.
 *
 * @param {Object} [defaultOptions] - Render options for every request to this target
 * @param {string} [defaultOptions.pathname] - Canonical page identifier; defaults to the normalized request pathname. Required in practice for routes with dynamic segments
 * @param {string} [defaultOptions.baseTemplateId] - Canonical base template identifier; required for full-page rendering
 * @param {string} [defaultOptions.partial] - Canonical page-partial identifier to render instead of the page and base templates
 * @param {boolean} [defaultOptions.skipBaseRender=false] - Render the page template without its base template
 * @param {boolean} [defaultOptions.usePageCache] - Enable rendered-page cache preparation, reads, and writes; defaults to the global value set in configuration
 * @param {string} [defaultOptions.cacheKey] - Cache identity component used only when page caching is enabled; defaults to request origin, pathname, and query string, then becomes part of an opaque hashed KV key
 * @param {boolean} [defaultOptions.includePropsInCacheKey] - Include response props in the rendered-page cache identity; defaults to true when page caching is enabled and false otherwise
 * @param {function(string, Object, Object): (string|Promise<string>)} [defaultOptions.propsHashFunction] - Returns the response-props hash from the page pathname, merged page context, and response props; used only when page caching and props-sensitive keys are enabled
 * @param {number} [defaultOptions.pageCacheReadTtlSeconds] - Cache TTL passed to enabled page-cache reads; defaults to the value set in configuration
 * @param {number} [defaultOptions.pageCacheExpirationSeconds] - Expiration passed to enabled page-cache writes; defaults to value set in configuration
 * @param {boolean} [defaultOptions.allowJsonResponse] - Serve assembled page context for explicit JSON requests and treat `.json` as a representation suffix; defaults to the value set in configuration
 * @param {Object} [defaultOptions.responseOptions] - Options forwarded to the UTF-8 response method
 * @param {string} [defaultOptions.responseOptions.contentType='text/plain'] - Response MIME type; a UTF-8 charset is appended
 * @param {Object|Headers|Array<[string,string]>} [defaultOptions.responseOptions.headers] - Additional response headers
 * @returns {function(Object, Object, Object): Promise<Object>} Request handler resolving to the mutated response
 * @see HyperviewService#respondWithHypertext in kixx/hyperview/hyperview-service.js for the render modes and cache behavior
 */
export default function HyperviewPageHandler(defaultOptions) {
    defaultOptions = defaultOptions ?? {};

    return async function hyperviewPageHandler(context, request, response) {
        // Copy before assigning below, so a per-request override never mutates the
        // options this target renders every other request with. A shallow copy is
        // enough because only top level keys are replaced here, and it preserves
        // option values a structured clone would reject, like propsHashFunction.
        const options = Object.assign({}, defaultOptions);

        if (isPlainObject(response.props.hyperviewOptions)) {
            Object.assign(options, response.props.hyperviewOptions);
        }

        // The client picks the render mode last, because only the browser knows
        // whether it is replacing a fragment, swapping a page body, or loading a
        // whole document from cold.
        if (request.headers.has('kixx-partial')) {
            options.partial = request.headers.get('kixx-partial');
        }
        if (request.headers.has('kixx-boosted')) {
            options.skipBaseRender = true;
        }

        const hyperview = context.getService('HyperviewService');

        return await hyperview.respondWithHypertext(context, request, response, options);
    };
}
