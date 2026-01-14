import VirtualHost from '../http-server/virtual-host.js';

import {
    assert,
    assertArray,
    assertFalsy,
    assertNonEmptyString
} from '../assertions/mod.js';


/**
 * Represents a virtual host specification with hostname matching and route definitions.
 * Provides validation, middleware assignment, route flattening, and conversion to executable instances.
 *
 * Virtual hosts enable hostname-based routing, allowing different routes for different domains
 * or subdomains. Supports exact hostname matching or pattern-based dynamic hostname routing.
 */
export default class VirtualHostSpec {

    /**
     * Creates a new VirtualHostSpec instance from a configuration object.
     *
     * The specification must include exactly one of hostname or pattern (but not both) for
     * hostname matching, along with a routes array defining the route hierarchy.
     *
     * @param {Object} spec - The virtual host specification object
     * @param {string} spec.name - Virtual host identifier used for debugging and logging
     * @param {string} [spec.hostname] - Exact hostname to match (mutually exclusive with pattern)
     * @param {string} [spec.pattern] - Hostname pattern for dynamic matching using PathToRegexp syntax (mutually exclusive with hostname)
     * @param {Array<HttpRouteSpec>} spec.routes - Array of validated HttpRouteSpec instances defining the route hierarchy
     */
    constructor(spec) {
        Object.defineProperties(this, {
            /**
             * Virtual host identifier used for debugging and logging purposes.
             * @name name
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * Exact hostname to match for this virtual host.
             * Null if pattern-based matching is used instead.
             * @name hostname
             * @type {string|null}
             */
            hostname: {
                value: spec.hostname,
                enumerable: true,
            },
            /**
             * Hostname pattern for dynamic matching using PathToRegexp syntax.
             * Null if exact hostname matching is used instead.
             * @name pattern
             * @type {string|null}
             */
            pattern: {
                value: spec.pattern,
                enumerable: true,
            },
            /**
             * Flattened array of route specifications after hierarchical composition.
             * Nested routes are flattened with parent properties merged into child routes.
             * @name routes
             * @type {Array<import('./http-route-spec.js').default>}
             */
            routes: {
                value: spec.routes,
                enumerable: true,
            },
        });
    }

    /**
     * Recursively assigns middleware, handlers, and error handlers to all routes in this virtual host.
     *
     * Resolves [name, options] tuples in route middleware definitions to actual middleware functions
     * using the provided registries. Processes all routes in the flattened routes array, which
     * recursively handles nested route structures.
     *
     * @param {Map<string, Function>} middleware - Registry mapping middleware names to factory functions
     * @param {Map<string, Function>} handlers - Registry mapping handler names to factory functions
     * @param {Map<string, Function>} errorHandlers - Registry mapping error handler names to factory functions
     * @returns {VirtualHostSpec} Returns this instance for method chaining
     */
    assignMiddleware(middleware, handlers, errorHandlers) {
        for (const routeSpec of this.routes) {
            routeSpec.assignMiddleware(middleware, handlers, errorHandlers, this.name);
        }

        return this;
    }

    /**
     * Converts this specification into an executable VirtualHost instance with compiled routes.
     *
     * Compiles the hostname pattern into a matcher function if pattern-based matching is used.
     * Transforms all route specifications into executable HttpRoute instances with compiled
     * pattern matching and resolved middleware.
     *
     * @returns {VirtualHost} New VirtualHost instance ready for request routing
     */
    toVirtualHost() {
        const routes = this.routes.map((route) => route.toHttpRoute(this));

        return new VirtualHost({
            name: this.name,
            hostname: this.hostname,
            pattern: this.pattern,
            routes,
        });
    }

    /**
     * Validates a configuration object and creates a new VirtualHostSpec instance.
     *
     * Performs comprehensive validation of hostname matching configuration and route structure.
     * Ensures exactly one of hostname or pattern is provided (mutually exclusive). Validates
     * hostname format and pattern syntax. Flattens nested route specifications into a single
     * array by merging parent route properties (path, middleware) onto child routes.
     *
     * @param {Object} spec - The virtual host specification object to validate
     * @param {string} [spec.name] - Optional virtual host name, defaults to hostname or pattern if not provided
     * @param {string} [spec.hostname] - Exact hostname to match (mutually exclusive with pattern)
     * @param {string} [spec.pattern] - Hostname pattern for dynamic matching using PathToRegexp syntax (mutually exclusive with hostname)
     * @param {Array<import('./http-route-spec.js').default>} spec.routes - Array of validated HttpRouteSpec instances defining the route hierarchy
     * @returns {VirtualHostSpec} The validated VirtualHostSpec instance with flattened route specifications
     */
    static validateAndCreate(spec) {
        spec = spec || {};

        // Require exactly one matching strategy: either exact hostname or pattern
        // Having both would create ambiguous matching behavior
        assert(
            spec.hostname || spec.pattern,
            'vhost.pattern or vhost.hostname must be provided'
        );

        assertFalsy(
            spec.hostname && spec.pattern,
            'Must define one of vhost.pattern OR vhost.hostname but NOT both'
        );

        const name = spec.hostname || spec.pattern;

        // Validate hostname format if provided
        if (spec.hostname) {
            assertNonEmptyString(spec.hostname, 'vhost.hostname must be a string');
        }

        if (spec.pattern) {
            assertNonEmptyString(spec.pattern, 'vhost.pattern must be a string');
        }

        assertArray(spec.routes, 'vhost.routes must be an Array');

        // Flatten nested route specifications into a single array.
        const routes = [];

        // Transform nested route tree into flat array by collapsing
        // parent route properties (path, middleware) onto child routes
        for (const route of spec.routes) {
            composeRouteSpecs(null, route);
        }

        /**
         * Recursively composes nested route specifications by merging parent properties into children.
         *
         * Traverses the route tree depth-first, merging parent route properties (path, middleware)
         * onto child routes. Routes with targets are leaf nodes and are added to the flattened array.
         * Routes without targets are intermediate nodes that define shared properties for their children.
         *
         * @param {HttpRouteSpec|null} parent - Parent route specification, null for root routes
         * @param {HttpRouteSpec} child - Child route specification to process
         */
        function composeRouteSpecs(parent, child) {
            if (parent) {
                // Merge parent route properties (path, middleware) onto child
                // This creates the inheritance chain for nested route definitions
                child = child.mergeParent(parent);
            }

            // Routes with targets are leaf nodes - actual request endpoints
            // Routes without targets are intermediate nodes that only define
            // shared properties for their children
            if (Array.isArray(child.targets)) {
                routes.push(child);
            } else {
                // Continue traversing the route tree, passing this route as parent
                // for the next level of nesting
                for (const grandchild of child.routes) {
                    composeRouteSpecs(child, grandchild);
                }
            }
        }

        return new VirtualHostSpec({
            name,
            hostname: spec.hostname || null,
            pattern: spec.pattern || null,
            routes,
        });
    }
}
