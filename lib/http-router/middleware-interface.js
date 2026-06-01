/**
 * Middleware function signature — the contracts for HTTP request processing
 * functions used in Kixx routes and targets.
 *
 * Middleware functions form a chain: each one processes the request and either
 * returns a response or calls skip() to pass control to the next middleware.
 *
 * ## MiddlewareFunction Invariants
 * - MUST return a ServerResponse (or a Promise resolving to one), OR call skip()
 * - MUST NOT both call skip() and return a response
 * - Throwing an Error causes the route's error handler chain to execute
 * - The `response` argument is the current response state; mutations may be
 *   made by calling methods on it, or modifying in place, before returning it
 */

/**
 * @typedef {import('./server-request-interface.js').ServerRequestInterface} ServerRequest
 */

/**
 * @typedef {import('./server-response.js').ServerResponse} ServerResponse
 */

/**
 * Middleware function for HTTP route handling.
 *
 * @typedef {function(RequestContext, ServerRequest, ServerResponse, Function): (Promise<ServerResponse>|ServerResponse)} MiddlewareFunction
 * @param {RequestContext} context - Application context with services and configuration
 * @param {ServerRequestInterface} request - Incoming HTTP request
 * @param {ServerResponse} response - Current HTTP response state
 * @param {Function} skip - Call to skip remaining middleware in the chain; return its result
 * @returns {Promise<ServerResponse>|ServerResponse} Updated response, or the result of skip()
 */
