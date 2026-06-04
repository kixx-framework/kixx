/**
 * Middleware function signature — the contract for HTTP request processing
 * functions used in Kixx routes and targets.
 *
 * Middleware functions form a chain. The router threads the response through
 * them: each middleware's return value becomes the `response` argument passed
 * to the next, and the value returned by the last one to run is the result. A
 * middleware can call skip() to halt the chain so the remaining middleware do
 * not run.
 *
 * ## MiddlewareFunction Invariants
 * - SHOULD return the ServerResponse (or a Promise resolving to it) so it is
 *   threaded to the next middleware. Returning a mutated `response` and
 *   returning a replacement response object are both honored.
 * - MAY instead mutate the shared `response` in place and return nothing; a
 *   nullish return keeps the current response, so mutate-in-place handlers work
 *   without an explicit return. The cost is that a forgotten return is
 *   indistinguishable from an intentional one.
 * - MAY call skip() to halt the chain after the current middleware. The
 *   response threaded at that point becomes the final response.
 * - Throwing an Error causes the route's error handler chain to execute.
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
 * Middleware function for HTTP route handling.
 *
 * @typedef {function(RequestContext, ServerRequest, ServerResponse, Function): (Promise<ServerResponse>|ServerResponse)} MiddlewareFunction
 * @param {RequestContext} context - Application context with services and configuration
 * @param {ServerRequest} request - Incoming HTTP request
 * @param {ServerResponse} response - Current HTTP response state, threaded from the previous middleware
 * @param {Function} skip - Halts the chain after this middleware runs
 * @returns {Promise<ServerResponse>|ServerResponse} Response threaded to the next middleware; a nullish return keeps the current response
 */
