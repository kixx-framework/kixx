import * as PathToRegexp from '../vendor/path-to-regexp/dist/index.js';
import { ValidationError } from '../errors/mod.js';
import HttpRoute from './http-route.js';
import {
    AssertionError,
    assertArray,
    assertGreaterThan,
    assertNonEmptyString,
    isNonEmptyString,
} from '../assertions/mod.js';


/**
 * @typedef {import('./http-route.js').default} HttpRoute
 */

/**
 * Hostname-based request routing within the HTTP routing hierarchy.
 *
 * VirtualHost sits between HttpRouter and HttpRoute in the routing hierarchy
 * (Router -> VirtualHost -> Route -> Target). It matches incoming requests by hostname
 * before the router delegates to the appropriate pathname route. Supports exact
 * hostname matching, wildcard catch-all ('*'), and pattern-based dynamic routing.
 */
export default class VirtualHost {

    #hostname = null;
    #matchPattern = null;

    /**
     * @param {Object} options - Virtual host configuration
     * @param {string} options.name - Display name for debugging and logging
     * @param {string} [options.hostname] - Exact hostname to match in reversed format, or '*' for catch-all
     * @param {string} [options.pattern] - Hostname pattern to match in reversed format
     * @param {Array<HttpRoute>} options.routes - Routes to handle requests for this host
     * @throws {AssertionError} When name, hostname/pattern, or routes are invalid
     */
    constructor(options) {
        const {
            name,
            hostname,
            pattern,
            routes,
        } = options ?? {};

        if (!isNonEmptyString(hostname) && !isNonEmptyString(pattern)) {
            throw new AssertionError('options.hostname or options.pattern must be a non-empty string');
        }
        if (isNonEmptyString(hostname) && isNonEmptyString(pattern)) {
            throw new AssertionError('options.hostname and options.pattern cannot both be defined');
        }
        assertNonEmptyString(name, 'options.name must be a non-empty string');
        assertArray(routes, 'options.routes must be an Array');
        assertGreaterThan(0, routes.length, 'options.routes must not be empty');

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
             * @type {ReadonlyArray<HttpRoute>}
             */
            routes: {
                enumerable: true,
                value: Object.freeze(routes.slice()),
            },
        });
    }

    /**
     * Tests if a hostname matches this virtual host's configured patterns
     *
     * Hostnames are reversed internally (www.example.com -> com.example.www) so
     * left-to-right matching runs from least to most specific (TLD first). Exact
     * matches are tried first for performance before falling back to pattern
     * matching.
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

    /**
     * Builds a VirtualHost from a configuration object, validating and flattening
     * nested route trees into a flat array of HttpRoute instances.
     *
     * @param {Object} spec - Virtual host specification
     * @param {string} [spec.name] - Display name (defaults to hostname or pattern)
     * @param {string} [spec.hostname] - Exact hostname to match (mutually exclusive with pattern)
     * @param {string} [spec.pattern] - Dynamic hostname pattern (mutually exclusive with hostname)
     * @param {Array<Object>} spec.routes - Route specification objects (may be nested)
     * @returns {VirtualHost} Configured virtual host with flattened routes
     * @throws {ValidationError} When specification is invalid
     */
    static fromSpecification(spec) {
        spec = spec || {};

        // Require exactly one matching strategy: either exact hostname or pattern
        // Having both would create ambiguous matching behavior
        if (!isNonEmptyString(spec.hostname) && !isNonEmptyString(spec.pattern)) {
            throw new ValidationError('vhost.pattern or vhost.hostname must be provided');
        }

        if (isNonEmptyString(spec.hostname) && isNonEmptyString(spec.pattern)) {
            throw new ValidationError('vhost.pattern and vhost.hostname cannot be defined together');
        }

        const name = spec.name || spec.hostname || spec.pattern;

        // Hostnames are matched in reverse; from least to most specific.
        const hostname = spec.hostname
            ? spec.hostname.split('.').reverse().join('.')
            : null;
        const pattern = spec.pattern
            ? reverseHostnamePattern(spec.pattern)
            : null;

        if (!Array.isArray(spec.routes)) {
            throw new ValidationError('vhost.routes must be an Array');
        }
        if (spec.routes.length === 0) {
            throw new ValidationError('vhost.routes must not be empty');
        }

        for (const routeSpec of spec.routes) {
            HttpRoute.validateSpecification(routeSpec);
        }

        const routes = flattenRoutes(spec.routes)
            .map((routeSpec) => HttpRoute.fromSpecification(routeSpec));

        return new VirtualHost({
            name,
            hostname,
            pattern,
            routes,
        });
    }
}

function reverseHostnamePattern(pattern) {
    return pattern.split('.').reverse().join('.');
}

function appendWildcardPattern(pattern) {
    if (pattern === '/') {
        return '/{*path}';
    }
    return `${ pattern.replace(/[/]+$/g, '') }{/*path}`;
}

function flattenRoutes(routes) {

    // Flatten nested route specifications into a single array.
    const flattenedRoutes = [];

    // Recursively composes nested route specifications by merging parent properties into children.
    // Traverses the route tree depth-first, merging parent route properties onto child routes.
    // Routes with targets are leaf nodes and are added to the flattened array. Routes without
    // targets are intermediate nodes that define shared properties for their children.
    function composeRouteSpecs(parent, child) {
        if (parent) {
            // Merge parent route properties (path, middleware) onto child
            // This creates the inheritance chain for nested route definitions
            child = mergeParentRoute(child, parent);
        }

        // Routes with targets are leaf nodes - actual request endpoints
        // Routes without targets are intermediate nodes that only define
        // shared properties for their children
        if (Array.isArray(child.targets)) {
            flattenedRoutes.push(child);
        } else {
            // Continue traversing the route tree, passing this route as parent
            // for the next level of nesting
            for (const grandchild of child.routes) {
                composeRouteSpecs(child, grandchild);
            }
        }
    }

    // Merges this route specification with a parent route specification, combining names, patterns,
    // middleware, and error handlers according to route composition rules.
    function mergeParentRoute(child, parent) {
        const parentName = isNonEmptyString(parent.name) ? parent.name : parent.pattern;
        const childName = isNonEmptyString(child.name) ? child.name : child.pattern;

        // Join name parts using a "/", but remove duplicates (replace "//" with "/").
        const name = `${ parentName }/${ childName }`.replace(/[/]+/g, '/');

        let pattern;
        // Wildcard parent patterns should not constrain child patterns
        // This allows mounting entire route trees at any path
        if (parent.pattern === '*') {
            pattern = child.pattern;
        } else if (child.pattern === '*') {
            pattern = appendWildcardPattern(parent.pattern);
        } else {
            // Remove consecutive slashes to handle cases like "/api/" + "/users"
            // Without this, we'd get "/api//users" which breaks path matching
            pattern = (parent.pattern + child.pattern).replace(/[/]+/g, '/');
        }

        // Middleware execution order matters for proper request/response flow:
        // Inbound: parent -> child (outside-in) for authentication, parsing, etc.
        const inboundMiddleware = (parent.inboundMiddleware ?? []).concat(child.inboundMiddleware ?? []);

        // Outbound: child -> parent (inside-out) for response transformation
        const outboundMiddleware = (child.outboundMiddleware ?? []).concat(parent.outboundMiddleware ?? []);

        // Error handlers: child -> parent (inside-out) so specific handlers run first
        const errorHandlers = (child.errorHandlers ?? []).concat(parent.errorHandlers ?? []);

        return {
            name,
            pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers,
            routes: child.routes,
            targets: child.targets,
        };
    }

    // Transform nested route tree into flat array by collapsing
    // parent route properties (path, middleware) onto child routes
    for (const route of routes) {
        composeRouteSpecs(null, route);
    }

    return flattenedRoutes;
}
