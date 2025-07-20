/**
 * Represents a single virtual host, including its hostname or pattern matcher,
 * name, and an array of route instances.
 *
 * @class
 * @classdesc
 * The VirtualHost class encapsulates the logic for matching incoming hostnames
 * (using either an exact hostname or a pattern matcher) and dispatching requests
 * to the appropriate route handlers for this virtual host.
 */
export default class VirtualHost {

    #hostname = null;
    #matchPattern = null;
    #routes = [];

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
     * Attempts to match the hostname directly (after reversing it) before using
     * the match pattern Regex. If a match is made with the hostname, an empty
     * object will be returned. If a match is made with the RegEx patternthen
     * the match pattern params capture will be returned.
     *
     * We match against com.example.www instead of www.example.com. This is
     * because our matching algorithm works from left to right.
     * Unlike in URL path matching, in hostnames, the segments move from least
     * granular to most granular. The subdomain is least granular, while
     * the .com is the highest level.
     *
     * @param  {string} hostname
     * @return {object|null}
     */
    matchHostname(hostname) {
        const parts = hostname.split('.').reverse();
        hostname = parts.join('.');

        // It doesn't matter if we try the match pattern or hostname first,
        // since both may NOT be defined on a single virtual host. But, we try
        // the hostname match first, here, just in case that changes.

        if (this.#hostname && (this.#hostname === '*' || hostname === this.#hostname)) {
            return {};
        }

        if (this.#matchPattern) {
            const res = this.#matchPattern(hostname);

            if (res) {
                return res.params;
            }
        }

        return null;
    }

    /**
     * Match an HttpRequest to a route in this virtual host. A match is made
     * by iterating through the routes registered on this virtual host and
     * calling HttpRoute:matchPathname() on each using the pathname of the
     * request URL. The first matching route is returned.
     *
     * If a match is made the [ HttpRoute, params ] tuple is returned.
     *
     * If no match can be made then [ null, null ] is returned.
     *
     * @param  {HttpRequest}
     * @return {[ HttpRoute, params ]}
     */
    matchRequest(request) {
        const { pathname } = request.url;

        for (const route of this.#routes) {
            const params = route.matchPathname(pathname);

            if (params) {
                return [ route, params ];
            }
        }

        return [ null, null ];
    }
}
