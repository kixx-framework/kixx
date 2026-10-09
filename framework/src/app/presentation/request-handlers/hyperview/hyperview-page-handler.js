import respondWithHyperviewPage from '../../lib/respond-with-hyperview-page.js';


/**
 * Creates a request handler that renders a Hyperview page response.
 *
 * Place the handler last in a target's request-handler chain. Earlier handlers
 * add template data with response.updateProps() or render controls with
 * response.setRenderingOptions().
 *
 * @param {Object} [defaultOptions] - Route render defaults.
 * @returns {function(Object, Object, Object): Promise<Object>} Request handler resolving to the committed response.
 */
export default function HyperviewPageHandler(defaultOptions) {
    return async function hyperviewPageHandler(context, request, response) {
        return await respondWithHyperviewPage(context, request, response, defaultOptions);
    };
}
