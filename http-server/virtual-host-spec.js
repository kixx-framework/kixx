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
 * @class VirtualHostSpec
 * @classdesc
 * Represents the specification for a single virtual host, including its hostname or pattern,
 * name, and an array of route specifications. Provides validation, middleware assignment,
 * flattening of nested routes, and conversion to an executable VirtualHost instance.
 */
export default class VirtualHostSpec {

    /**
     * Constructs a new VirtualHostSpec instance from a plain object specification.
     * If a name is not provided, the hostname or pattern will be used as a name.
     * The specification must include either a hostname or pattern property, but not both.
     * The specification must also include an array of route specifications.
     *
     * @param {Object} spec - The virtual host specification.
     * @param {string} [spec.name] - Optional name for the virtual host.
     * @param {string} [spec.hostname] - Hostname to match exactly.
     * @param {string} [spec.pattern] - Pattern to match hostnames against.
     * @param {Array} spec.routes - Array of route specifications.
     */
    constructor(spec) {
        /**
         * The name of the virtual host.
         * @type {string|undefined}
         */
        this.name = spec.name;

        /**
         * The exact hostname to match for this virtual host.
         * @type {string|undefined}
         */
        this.hostname = spec.hostname;

        /**
         * The pattern to match hostnames against for this virtual host.
         * @type {string|undefined}
         */
        this.pattern = spec.pattern;

        /**
         * The array of route specifications for this virtual host.
         * @type {Array}
         */
        this.routes = spec.routes;
    }

    /**
     * Assigns middleware, handlers, and error handlers to all routes in this virtual host.
     * Iterates through the routes array and calls assignMiddleware() on each route.
     *
     * @param {Map} middleware - Middleware functions to assign.
     * @param {Map} handlers - Route handlers to assign.
     * @param {Map} errorHandlers - Error handlers to assign.
     * @returns {VirtualHostSpec} Returns this for chaining.
     */
    assignMiddleware(middleware, handlers, errorHandlers) {
        for (let i = 0; i < this.routes.length; i += 1) {
            this.routes[i].assignMiddleware(middleware, handlers, errorHandlers, this.name, i);
        }

        return this;
    }

    /**
     * Flattens nested route specifications into a single array of routes.
     * Iterates through the routes array and recursively composes any nested
     * routes into a flat array using composeRouteSpecs().
     *
     * @returns {VirtualHostSpec} Returns this for chaining.
     */
    flattenRoutes() {
        const routes = [];

        for (const route of this.routes) {
            composeRouteSpecs(routes, null, route);
        }

        this.routes = routes;

        return this;
    }

    /**
     * Converts this VirtualHostSpec into a VirtualHost instance.
     * Creates a pattern matcher function if a pattern is defined.
     * Maps the route specifications to HttpRoute instances.
     *
     * @returns {VirtualHost} A new VirtualHost instance configured with this spec's properties.
     */
    toVirtualHost() {
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
     * Validates a plain object specification and creates a new VirtualHostSpec instance.
     * Ensures that either a hostname or pattern is provided (but not both), validates the
     * pattern if present, and validates the routes array. Each route is validated and created
     * using HttpRouteSpec.validateAndCreate.
     *
     * @param {Object} spec - The virtual host specification to validate and create.
     * @returns {VirtualHostSpec} A new validated VirtualHostSpec instance.
     * @throws {AssertionError} If validation fails.
     */
    static validateAndCreate(spec) {
        spec = spec || {};

        const reportingName = spec.name || spec.hostname || spec.pattern;

        assert(
            spec.hostname || spec.pattern,
            `vhost.pattern or vhost.hostname must be provided (in ${ reportingName })`
        );

        assertFalsy(
            spec.hostname && spec.pattern,
            `Cannot define both vhost.pattern AND vhost.hostname (in ${ reportingName })`
        );

        const name = reportingName;

        if (spec.hostname) {
            assertNonEmptyString(
                spec.hostname,
                `vhost.hostname must be a string (in ${ reportingName })`
            );
        }
        if (spec.pattern) {
            try {
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

        // Copy the routes over to a new Array since we're going to be
        // mutating them during the validation process.
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
 * Called recursively to walk through the routes tree. Child routes are
 * merged/collapsed onto parent routes and HttpTargets are composed on the
 * collapsed route.
 * @param  {Array}
 * @param  {object|null}
 * @param  {object}
 * @return {Array}
 */
export function composeRouteSpecs(routes, parent, child) {
    if (parent) {
        child = child.mergeParent(parent);
    }

    // If the route has targets then we are at the end of the
    // route tree; at a leaf node; an endpoint.
    if (Array.isArray(child.targets)) {
        routes.push(child);
    } else {
        // If the route does not have targets then we are still collapsing
        // the route tree for at least one more generation.
        for (const grandchild of child.routes) {
            composeRouteSpecs(routes, child, grandchild);
        }
    }

    return routes;
}
