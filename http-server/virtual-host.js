/**
 * @fileoverview Virtual host routing and request dispatching
 * 
 * This module provides the VirtualHost class for hostname-based routing
 * in web applications, supporting both exact hostname matching and 
 * pattern-based dynamic routing.
 */

/**
 * @typedef {Object} HttpRequest
 * @property {URL} url - Parsed URL object with pathname and other components
 */

/**
 * @typedef {Object} HttpRoute  
 * @property {function} matchPathname - Method to match URL pathname against route pattern
 */

/**
 * @typedef {Object} VirtualHostConfig
 * @property {string} name - Display name for this virtual host
 * @property {string} [hostname] - Exact hostname to match (e.g., 'com.example.www')
 * @property {function} [patternMatcher] - Function to match hostname patterns
 * @property {HttpRoute[]} routes - Array of route handlers for this virtual host
 */

/**
 * Handles hostname-based request routing with support for exact matches and patterns
 * 
 * @class
 */
export default class VirtualHost {

    #hostname = null;
    #matchPattern = null;
    #routes = [];

    /**
     * Creates a new virtual host instance
     * 
     * @param {VirtualHostConfig} config - Virtual host configuration
     * @throws {TypeError} When required configuration is missing or invalid
     */
    constructor({ name, hostname, patternMatcher, routes }) {
        this.#hostname = hostname || null;
        this.#matchPattern = patternMatcher;
        this.#routes = routes;

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
        });
    }

    /**
     * Checks if this virtual host can handle the given hostname
     * 
     * @param {string} hostname - The hostname to match (e.g., 'www.example.com')
     * @returns {Object|null} Parameters object if matched, null if no match
     * @throws {TypeError} When hostname is not a string
     * 
     * @example
     * // Exact hostname match
     * const params = vhost.matchHostname('www.example.com');
     * // Returns {} for exact match, null for no match
     * 
     * @example  
     * // Pattern match with captured parameters
     * const params = vhost.matchHostname('api.example.com');
     * // May return { subdomain: 'api' } for pattern matches
     */
    matchHostname(hostname) {
        // Reverse hostname segments for left-to-right matching
        // Domain hierarchy: TLD -> domain -> subdomain (com.example.www)
        // This allows pattern matching to work intuitively from most to least specific
        const parts = hostname.split('.').reverse();
        hostname = parts.join('.');

        // Try exact hostname match first for performance
        // Exact matches are O(1) while pattern matching is O(n)
        if (this.#hostname && (this.#hostname === '*' || hostname === this.#hostname)) {
            // '*' wildcard matches any hostname for catch-all virtual hosts
            // Empty object indicates successful match with no captured parameters
            return {};
        }

        // Fall back to pattern matching for dynamic hostname routing
        if (this.#matchPattern) {
            const res = this.#matchPattern(hostname);

            if (res) {
                // Return captured parameters from pattern match (e.g., subdomain variables)
                return res.params;
            }
        }

        // No match found - this virtual host doesn't handle this hostname
        return null;
    }

    /**
     * Finds the first route that matches the request pathname
     * 
     * @param {HttpRequest} request - HTTP request object with URL
     * @returns {[HttpRoute|null, Object|null]} Tuple of matched route and parameters, or nulls if no match
     * @throws {TypeError} When request is missing or invalid
     * 
     * @example
     * // Successful route match
     * const [route, params] = vhost.matchRequest(request);
     * if (route) {
     *   // Handle request with matched route and extracted parameters
     * }
     * 
     * @example
     * // No route found
     * const [route, params] = vhost.matchRequest(request);
     * // Both route and params will be null
     */
    matchRequest(request) {
        const { pathname } = request.url;

        // Iterate through routes in registration order
        // First match wins - route order matters for overlapping patterns
        for (const route of this.#routes) {
            const params = route.matchPathname(pathname);

            if (params) {
                // Return tuple: [matched route, extracted path parameters]
                // This pattern allows caller to get both the handler and route data
                return [ route, params ];
            }
        }

        // No route matched this pathname
        // Tuple format maintains consistency even for no-match case
        return [ null, null ];
    }
}
