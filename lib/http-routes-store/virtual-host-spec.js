import { PathToRegexp } from '../vendor/mod.js';
import { AssertionError } from '../errors/mod.js';
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
 */
export default class VirtualHostSpec {

    /**
     * Creates a new VirtualHostSpec from a configuration object.
     * Must include either hostname or pattern (but not both) and a routes array.
     */
    constructor(spec) {
        Object.defineProperties(this, {
            /**
             * @type {string}
             */
            name: {
                value: spec.name,
                enumerable: true,
            },
            /**
             * @type {string}
             */
            hostname: {
                value: spec.hostname,
                enumerable: true,
            },
            /**
             * @type {string}
             */
            pattern: {
                value: spec.pattern,
                enumerable: true,
            },
            /**
             * @type {Array<HttpRouteSpec>}
             */
            routes: {
                value: spec.routes,
                enumerable: true,
            },
        });
    }

    /**
     * Recursively assigns middleware, handlers, and error handlers to all routes.
     */
    assignMiddleware(middleware, handlers, errorHandlers) {
        for (const routeSpec of this.routes) {
            routeSpec.assignMiddleware(middleware, handlers, errorHandlers, this.name);
        }

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
            try {
                // PathToRegexp.match will throw if pattern syntax is invalid
                // Testing here prevents runtime errors when routes are used
                PathToRegexp.match(spec.pattern);
            } catch (cause) {
                throw new AssertionError(
                    `Invalid vhost.pattern: ${ typeof spec.pattern } ${ spec.pattern } (${ cause.message })`
                );
            }
        }

        assertArray(spec.routes, 'vhost.routes must be an Array');

        // Flatten nested route specifications into a single array.
        const routes = [];

        // Transform nested route tree into flat array by collapsing
        // parent route properties (path, middleware) onto child routes
        for (const route of spec.routes) {
            composeRouteSpecs(null, route);
        }

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
