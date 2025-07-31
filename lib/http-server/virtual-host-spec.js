/**
 * @fileoverview Virtual host specification and route composition utilities
 *
 * Provides the VirtualHostSpec class for defining and validating virtual host
 * configurations with hostname/pattern matching and route hierarchies. Includes
 * utilities for flattening nested route structures and converting specifications
 * to executable VirtualHost instances.
 */

import { PathToRegexp } from '../vendor/mod.js';
import { AssertionError } from '../errors/mod.js';
import VirtualHost from './virtual-host.js';
import HttpRouteSpec from './http-route-spec.js';

import {
    assert,
    assertArray,
    assertFalsy,
    assertNonEmptyString
} from '../assertions/mod.js';

/**
 * @typedef {Object} VirtualHostSpecConfig
 * @property {string} [name] - Optional name for the virtual host
 * @property {string} [hostname] - Exact hostname to match
 * @property {string} [pattern] - Pattern to match hostnames against
 * @property {Array<Object>} routes - Array of route specification objects
 */

/**
 * Represents a virtual host specification with hostname matching and route definitions.
 * Provides validation, middleware assignment, route flattening, and conversion to executable instances.
 */
export default class VirtualHostSpec {

    /**
     * Creates a new VirtualHostSpec from a configuration object.
     * Must include either hostname or pattern (but not both) and a routes array.
     *
     * @param {VirtualHostSpecConfig} spec - The virtual host configuration
     */
    constructor(spec) {
        /**
         * @type {string|undefined}
         */
        this.name = spec.name;

        /**
         * @type {string|undefined}
         */
        this.hostname = spec.hostname;

        /**
         * @type {string|undefined}
         */
        this.pattern = spec.pattern;

        /**
         * @type {Array<HttpRouteSpec>}
         */
        this.routes = spec.routes;
    }

    /**
     * Assigns middleware, handlers, and error handlers to all routes.
     *
     * @param {Map<string, Function>} middleware - Named middleware functions
     * @param {Map<string, Function>} handlers - Named route handler functions
     * @param {Map<string, Function>} errorHandlers - Named error handler functions
     * @returns {VirtualHostSpec} This instance for chaining
     */
    assignMiddleware(middleware, handlers, errorHandlers) {
        for (let i = 0; i < this.routes.length; i += 1) {
            // Pass vhost name and index for error reporting context
            // during middleware resolution failures
            this.routes[i].assignMiddleware(middleware, handlers, errorHandlers, this.name, i);
        }

        return this;
    }

    /**
     * Flattens nested route specifications into a single array.
     * Child routes inherit properties from parent routes.
     *
     * @returns {VirtualHostSpec} This instance for chaining
     */
    flattenRoutes() {
        const routes = [];

        // Transform nested route tree into flat array by collapsing
        // parent route properties (path, middleware) onto child routes
        for (const route of this.routes) {
            composeRouteSpecs(routes, null, route);
        }

        this.routes = routes;

        return this;
    }

    /**
     * Converts this specification into an executable VirtualHost instance.
     * Creates pattern matcher function if pattern is defined.
     *
     * @returns {VirtualHost} New VirtualHost instance with compiled routes
     */
    toVirtualHost() {
        // Only compile pattern matcher if we have a pattern (not exact hostname)
        // PathToRegexp.match() returns a function for dynamic hostname matching
        const patternMatcher = this.pattern ? PathToRegexp.match(this.pattern) : null;

        const routes = this.routes.map((route) => route.toHttpRoute(this));

        return new VirtualHost({
            name: this.name,
            hostname: this.hostname,
            patternMatcher,
            routes,
        });
    }

    /**
     * Validates a configuration object and creates a new VirtualHostSpec.
     * Ensures exactly one of hostname or pattern is provided and validates all routes.
     *
     * @param {Object} spec - The virtual host configuration to validate
     * @returns {VirtualHostSpec} New validated VirtualHostSpec instance
     * @throws {AssertionError} When hostname/pattern requirements not met
     * @throws {AssertionError} When hostname is not a non-empty string
     * @throws {AssertionError} When pattern is invalid regex syntax
     * @throws {AssertionError} When routes is not an array
     * @throws {AssertionError} When individual route validation fails
     */
    static validateAndCreate(spec) {
        spec = spec || {};

        // Use any available identifier for error reporting context
        const reportingName = spec.name || spec.hostname || spec.pattern;

        // Require exactly one matching strategy: either exact hostname or pattern
        // Having both would create ambiguous matching behavior
        assert(
            spec.hostname || spec.pattern,
            `vhost.pattern or vhost.hostname must be provided (in ${ reportingName })`
        );

        assertFalsy(
            spec.hostname && spec.pattern,
            `Cannot define both vhost.pattern AND vhost.hostname (in ${ reportingName })`
        );

        const name = reportingName;

        // Validate hostname format if provided
        if (spec.hostname) {
            assertNonEmptyString(
                spec.hostname,
                `vhost.hostname must be a string (in ${ reportingName })`
            );
        }

        // Validate pattern compilation if provided
        if (spec.pattern) {
            try {
                // Test pattern compilation early to catch invalid regex patterns
                PathToRegexp.match(spec.pattern);
            } catch (cause) {
                throw new AssertionError(
                    `Invalid vhost pattern: ${ typeof spec.pattern } ${ spec.pattern } in ${ reportingName }`,
                    { cause }
                );
            }
        }

        assertArray(
            spec.routes,
            `vhost.routes must be an Array (in ${ reportingName })`
        );

        // Copy routes to new array to avoid mutating original spec
        // during validation process (maintains input immutability)
        const routes = [];

        for (let i = 0; i < spec.routes.length; i += 1) {
            routes.push(HttpRouteSpec.validateAndCreate(spec.routes[i], name, i));
        }

        return new VirtualHostSpec({
            name,
            hostname: spec.hostname,
            pattern: spec.pattern,
            routes,
        });
    }
}


/**
 * Recursively flattens nested route specifications into a single array.
 * Child routes inherit properties from parent routes. Only leaf nodes with targets are added.
 *
 * @param {Array<HttpRouteSpec>} routes - Accumulator array for flattened routes
 * @param {HttpRouteSpec|null} parent - Parent route to inherit properties from
 * @param {HttpRouteSpec} child - Current route being processed
 * @returns {Array<HttpRouteSpec>} The routes array for chaining
 */
export function composeRouteSpecs(routes, parent, child) {
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
            composeRouteSpecs(routes, child, grandchild);
        }
    }

    return routes;
}
