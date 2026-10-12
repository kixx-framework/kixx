/**
 * Middleware function signature — the contract for HTTP request processing
 * functions used in Kixx routes and targets.
 *
 * Middleware functions form a chain with two phases: a request phase (inbound
 * middleware and request handlers) followed by an outbound (response) phase.
 * The router threads the response through them: each middleware's return value
 * becomes the `response` argument passed to the next, and the value returned by
 * the last one to run is the result. A request-phase middleware can call skip()
 * to end the request phase early; the outbound phase still runs afterward.
 *
 * ## MiddlewareFunction Invariants
 * - SHOULD return the ServerResponse (or a Promise resolving to it) so it is
 *   threaded to the next middleware. Returning a mutated `response` and
 *   returning a replacement response object are both honored.
 * - MAY instead mutate the shared `response` in place and return nothing; a
 *   nullish return keeps the current response, so mutate-in-place handlers work
 *   without an explicit return. The cost is that a forgotten return is
 *   indistinguishable from an intentional one.
 * - MAY call skip() to end the request phase after the current middleware, so no
 *   further inbound middleware or request handlers run. The outbound phase still
 *   runs to completion. Outbound middleware are not passed skip() and cannot
 *   short-circuit the chain.
 * - Throwing an Error causes the route's error handler chain to execute; the
 *   outbound phase does not run for that request.
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
 * @param {Function} skip - Ends the request phase after this middleware runs; the outbound phase still runs. Not provided to outbound middleware.
 * @returns {Promise<ServerResponse>|ServerResponse} Response threaded to the next middleware; a nullish return keeps the current response
 */
