import { assertAcceptsJsonApi } from '../lib/json-api.js';


/**
 * Rejects a request whose Accept header cannot take a JSON:API response.
 * @param {import('../../../kixx/context/request-context.js').default} _context - Active request context.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @param {import('../../../kixx/http-router/server-response.js').default} response - Current response state.
 * @returns {import('../../../kixx/http-router/server-response.js').default} Response threaded to the next middleware.
 * @throws {NotAcceptableError} When every JSON:API Accept entry carries an unsupported parameter.
 */
export default function negotiateJsonApi(_context, request, response) {
    assertAcceptsJsonApi(request);
    return response;
}
