/**
 * Middleware and error handler function signatures — the contracts for HTTP
 * request processing functions used in Kixx route targets.
 *
 * Middleware functions form a chain: each one processes the request and either
 * returns a response or calls skip() to pass control to the next middleware.
 * Error handler functions form a cascade: each one either handles the error
 * and returns a response, or returns false to pass the error to the next handler.
 *
 * ## MiddlewareFunction Invariants
 * - MUST return a ServerResponse (or a Promise resolving to one), OR call skip()
 *   and return its result
 * - MUST NOT both call skip() and return a response
 * - Throwing an Error causes the route's error handler chain to execute
 * - The `response` argument is the current response state; mutations should be
 *   made by returning a new or modified response, not by modifying in place
 *
 * ## ErrorHandlerFunction Invariants
 * - MUST return a ServerResponse (or Promise resolving to one) if the error is
 *   handled, OR return false (or Promise resolving to false) to pass to the next
 *   error handler
 * - MUST NOT throw; unhandled errors in error handlers are logged and swallowed
 * - Returning false from every error handler in the chain results in a generic
 *   500 response being sent to the client
 *
 * @module ports/middleware
 */

/**
 * @typedef {import('./http-server-request.js').ServerRequest} ServerRequest
 */

/**
 * @typedef {import('./http-server-response.js').ServerResponse} ServerResponse
 */

/**
 * Middleware function for HTTP route handling.
 *
 * @typedef {function(RequestContext, ServerRequest, ServerResponse, Function): (Promise<ServerResponse>|ServerResponse)} MiddlewareFunction
 * @param {RequestContext} context - Application context with services and configuration
 * @param {ServerRequest} request - Incoming HTTP request
 * @param {ServerResponse} response - Current HTTP response state
 * @param {Function} skip - Call to skip remaining middleware in the chain; return its result
 * @returns {Promise<ServerResponse>|ServerResponse} Updated response, or the result of skip()
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
