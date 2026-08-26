/**
 * Renders and commits a Hyperview page response.
 *
 * Route defaults are overridden by response rendering options, then by the
 * client-selected partial or boosted render mode.
 *
 * @param {Object} context - Active request context.
 * @param {Object} request - Incoming HTTP request with headers.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Response carrying template props and rendering options.
 * @param {Object} [defaultOptions] - Route or caller render defaults; responseOptions remain presentation-only.
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
    const responseOptions = {
        ...configuredResponseOptions,
        contentType: configuredResponseOptions?.contentType ?? 'text/html',
    };
    const hyperviewService = context.getService('HyperviewService');
    const result = await hyperviewService.renderPage(context, {
        ...renderOptions,
        props: response.props,
        url: request.url,
    });

    if (result.type === 'hypertext') {
        return response.respondWithUtf8(response.status, result.hypertext, responseOptions);
    }

    if (result.type === 'page-context') {
        return response.respondWithJSON(response.status, result.pageContext, { whiteSpace: 4 });
    }

    throw new TypeError(`Unknown Hyperview render result type: ${ result.type }`);
}
