import { PathToRegexp } from '../vendor/mod.js';


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
     * Creates a virtual host with hostname matching and route delegation
     * @param {Object} options - Virtual host configuration
     * @param {string} options.name - Display name for debugging and logging
     * @param {string} [options.hostname] - Exact hostname to match in reversed format, or '*' for catch-all
     * @param {string} [options.pattern] - Pattern for dynamic hostname matching
     * @param {Array<HttpRoute>} options.routes - Routes to handle requests for this host
     */
    constructor({ name, hostname, pattern, routes }) {
        // Compile pattern matcher only when needed (not for exact hostname matches)
        // PathToRegexp.match() returns a function for dynamic hostname matching
        this.#matchPattern = pattern ? PathToRegexp.match(pattern) : null;
        this.#hostname = hostname || null;

        Object.defineProperties(this, {
            /**
             * Display name for debugging and logging
             * @name name
             * @type {string}
             */
            name: {
                enumerable: true,
                value: name,
            },
            /**
             * Routes registered for this virtual host
             * @name routes
             * @type {Array<HttpRoute>}
             */
            routes: {
                enumerable: true,
                value: routes,
            },
        });
    }

    /**
     * Tests if a hostname matches this virtual host's configured patterns
     *
     * Hostnames are reversed internally (www.example.com -> com.example.www) for
     * left-to-right matching from most to least specific. Exact matches are tried
     * first for performance before falling back to pattern matching.
     *
     * @param {string} hostname - Hostname to match (e.g., 'www.example.com')
     * @returns {Object|null} Captured parameters if matched (empty object for exact match), null otherwise
     */
    matchHostname(hostname) {
        // Reverse hostname segments for left-to-right matching
        // www.example.com -> com.example.www allows pattern matching TLD first
        const parts = hostname.split('.').reverse();
        hostname = parts.join('.');

        // Try exact hostname match first - O(1) vs O(n) for pattern matching
        if (this.#hostname && (this.#hostname === '*' || hostname === this.#hostname)) {
            // '*' wildcard matches any hostname for catch-all virtual hosts
            return {};
        }

        // Fall back to pattern matching for dynamic hostname routing
        if (this.#matchPattern) {
            const res = this.#matchPattern(hostname);

            if (res) {
                // Return captured parameters (e.g., subdomain variables)
                return res.params;
            }
        }

        // No match found
        return null;
    }

}
