/**
 * @callback PatternMatcherFunction
 * @param {string} hostname - Reversed hostname to match (e.g., 'com.example.www')
 * @returns {{params: Object}|null} Match result with captured parameters, or null
 */

/**
 * Hostname-based request routing within the HTTP routing hierarchy.
 *
 * VirtualHost sits between HttpRouter and HttpRoute in the routing hierarchy
 * (Router -> VirtualHost -> Route -> Target). It matches incoming requests by hostname
 * and delegates to the appropriate route based on pathname. Supports exact hostname
 * matching, wildcard catch-all ('*'), and pattern-based dynamic routing.
 *
 * @class
 */
export default class VirtualHost {

    /**
     * Exact hostname to match in reversed format (e.g., 'com.example.www')
     * @type {string|null}
     */
    #hostname = null;

    /**
     * Pattern matcher function for dynamic hostname routing
     * @type {PatternMatcherFunction|null}
     */
    #matchPattern = null;

    /**
     * Routes registered for this virtual host, matched in order
     * @type {Array<HttpRoute>}
     */
    #routes = [];

    /**
     * Creates a new virtual host instance
     * @param {Object} options - Virtual host configuration
     * @param {string} options.name - Display name for debugging and logging
     * @param {string} [options.hostname] - Exact hostname to match in reversed format, or '*' for catch-all
     * @param {PatternMatcherFunction} [options.patternMatcher] - Function for dynamic hostname matching
     * @param {Array<HttpRoute>} options.routes - Routes to handle requests for this host
     */
    constructor({ name, hostname, patternMatcher, routes }) {
        this.#hostname = hostname || null;
        this.#matchPattern = patternMatcher;
        this.#routes = routes;

        Object.defineProperties(this, {
            /**
             * @name name
             * Display name for debugging and logging
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
        });
    }

    /**
     * Matches a hostname against this virtual host's configured patterns
     *
     * Hostnames are reversed internally (www.example.com -> com.example.www) for
     * left-to-right matching from most to least specific. Exact matches are tried
     * first for performance before falling back to pattern matching.
     *
     * @param {string} hostname - The hostname to match (e.g., 'www.example.com')
     * @returns {Object|null} Captured parameters if matched (empty object for exact match), null otherwise
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
     * Routes are matched in registration order; first match wins. For overlapping
     * patterns, more specific routes should be registered before general ones.
     *
     * @param {HttpServerRequest} request - HTTP request object with URL containing pathname
     * @returns {[HttpRoute|null, Object|null]} Tuple of [route, pathParams] if matched, [null, null] otherwise
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
