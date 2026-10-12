/**
 * Error handler function signature — the contract for HTTP request error
 * handling functions used in Kixx routes and targets.
 *
 * Error handler functions form a cascade: each one either handles the error and
 * returns a response, or returns false to pass the error to the next handler.
 * The cascade runs from the most specific level to the most general
 * (target -> route -> router).
 *
 * ## ErrorHandlerFunction Invariants
 * - MUST return a ServerResponse (or a Promise resolving to one) when it handles
 *   the error, OR return false (or a Promise resolving to false) to pass the
 *   error to the next handler.
 * - SHOULD NOT throw. A throw from an error handler is not caught by the router;
 *   it propagates out of the request so the platform server applies its
 *   fatal-error policy.
 * - When every target- and route-level handler returns false, the router's
 *   built-in handler converts expected HTTP errors into a JSON:API response.
 *   Unexpected (non-HTTP) errors are instead re-thrown so the platform server
 *   can apply its fatal-error policy.
 */

/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 */

/**
 * @typedef {import('./server-request-interface.js').ServerRequestInterface} ServerRequest
 */

/**
 * @typedef {import('./server-response.js').default} ServerResponse
 */

/**
 * Error handler function for HTTP route handling.
 *
 * @typedef {function(RequestContext, ServerRequest, ServerResponse, Error): (Promise<ServerResponse|false>|ServerResponse|false)} ErrorHandlerFunction
 * @param {RequestContext} context - Application context with services and configuration
 * @param {ServerRequest} request - Incoming HTTP request
 * @param {ServerResponse} response - Current HTTP response state
 * @param {Error} error - The error to handle
 * @returns {Promise<ServerResponse|false>|ServerResponse|false} Response if handled, false to pass to next handler
 */
