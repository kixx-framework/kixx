import { ValidationError } from '../errors.js';
import {
    isNonEmptyString
} from '../assertions.js';

import HttpRouteSpec from './http-route-spec.js';


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
        if (!isNonEmptyString(spec.hostname) && !isNonEmptyString(spec.pattern)) {
            throw new ValidationError('vhost.pattern or vhost.hostname must be provided');
        }

        if (spec.hostname && spec.pattern) {
            throw new ValidationError('vhost.pattern and vhost.hostname cannot be defined together');
        }

        const name = spec.name || spec.hostname || spec.pattern;

        // Validate hostname format if provided
        if (spec.hostname) {
            if (!isNonEmptyString(spec.hostname)) {
                throw new ValidationError('vhost.hostname must be a string');
            }
        }

        if (spec.pattern) {
            if (!isNonEmptyString(spec.pattern)) {
                throw new ValidationError('vhost.pattern must be a string');
            }
        }

        if (!Array.isArray(spec.routes)) {
            throw new ValidationError('vhost.routes must be an Array');
        }

        const routes = spec.routes.map(HttpRouteSpec.validateAndCreate);

        // Flatten nested route specifications into a single array.
        const flattenedRoutes = [];

        // Transform nested route tree into flat array by collapsing
        // parent route properties (path, middleware) onto child routes
        for (const route of routes) {
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
                flattenedRoutes.push(child);
            } else {
                // Continue traversing the route tree, passing this route as parent
                // for the next level of nesting
                for (const grandchild of child.routes) {
                    composeRouteSpecs(child, grandchild);
                }
            }
        }

        // Hostnames are matched in reverse; from least to most specific.
        const hostname = spec.hostname
            ? spec.hostname.split('.').reverse().join('.')
            : null;

        return new VirtualHostSpec({
            name,
            hostname,
            pattern: spec.pattern || null,
            routes: flattenedRoutes,
        });
    }
}
