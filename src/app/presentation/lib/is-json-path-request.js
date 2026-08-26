/**
 * Identifies Hyperview's pathname-based JSON representation.
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request.
 * @returns {boolean} True when the request pathname ends in `.json`, matched case-insensitively.
 */
export default function isJsonPathRequest(request) {
    return request.url.pathname.toLowerCase().endsWith('.json');
}
