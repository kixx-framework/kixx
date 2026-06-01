/**
 * Error handler function signatures — the contracts for HTTP request error
 * handling functions used in Kixx route targets.
 *
 * Error handler functions form a cascade: each one either handles the error
 * and returns a response, or returns false to pass the error to the next handler.
 *
 * ## ErrorHandlerFunction Invariants
 * - MUST return a ServerResponse (or Promise resolving to one) if the error is
 *   handled, OR return false (or Promise resolving to false) to pass to the next
 *   error handler
 * - MUST NOT throw; unhandled errors in error handlers are logged and then
 *   will crash the server
 * - Returning false from every error handler in the chain results in a generic
 *   500 response being sent to the client
 */

/**
 * @typedef {import('./server-request-interface.js').ServerRequestInterface} ServerRequest
 */

/**
 * @typedef {import('./server-response.js').ServerResponse} ServerResponse
 */

/**
 * Error handler function for HTTP route handling.
 *
 * @typedef {function(RequestContext, ServerRequest, ServerResponse, Error): (Promise<ServerResponse|false>|ServerResponse|false)} ErrorHandlerFunction
 * @param {RequestContext} context - Application context with services and configuration
 * @param {ServerRequestInterface} request - Incoming HTTP request
 * @param {ServerResponse} response - Current HTTP response state
 * @param {Error} error - The error to handle
 * @returns {Promise<ServerResponse|false>|ServerResponse|false} Response if handled, false to pass to next handler
 */
