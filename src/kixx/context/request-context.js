import {
    AssertionError,
    isNonEmptyString,
} from '../assertions/mod.js';

import BaseContext from './base-context.js';


/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @typedef {import('./app-runtime.js').default} AppRuntime
 */

/**
 * @typedef {import('../http-router/http-route.js').default} HttpRoute
 */

/**
 * @typedef {import('../http-router/http-target.js').default} HttpTarget
 */

/**
 * Request-scoped context passed through HTTP middleware, handlers, and data gateways.
 *
 * The request context exposes the current request environment, logger, runtime
 * metadata, shared application services, shared collections, route lookup helpers,
 * and the optional authenticated user. ApplicationContext creates one instance
 * per request, and HttpRouter injects the matched VirtualHost routes before
 * target middleware runs.
 *
 * @extends BaseContext
 */
export default class RequestContext extends BaseContext {

    #services;
    #collections;
    #routes;
    #user = null;

    /**
     * @param {Object} config
     * @param {Object} config.env - Request-scoped environment variables, secrets, and platform bindings.
     * @param {Logger} config.logger - Root application logger.
     * @param {AppRuntime} config.runtime - Runtime metadata shared by all request contexts.
     * @param {Map<string, Object>} config.services - Application service registry shared with ApplicationContext.
     * @param {Map<string, Object>} config.collections - Application collection registry shared with ApplicationContext.
     * @param {string} [config.requestId] - Identifier for the request being handled, when available.
     */
    constructor(config) {
        super(config);

        const {
            services,
            collections,
            requestId,
        } = config;

        this.#services = services;
        this.#collections = collections;

        Object.defineProperties(this, {
            /**
             * Identifier for the current request, or undefined when no request
             * object was available while creating this context.
             * @name requestId
             * @type {string|undefined}
             */
            requestId: { value: requestId, enumerable: true },
        });
    }

    /**
     * Sets the routes used by the HTTP target lookup helpers.
     *
     * The router calls this with the matched VirtualHost routes before invoking
     * target middleware. The route list is copied so later caller-side array
     * mutations do not change lookup behavior for this request.
     *
     * @param {Array<HttpRoute>} routes - Routes visible to the current request.
     * @returns {RequestContext} This context instance for method chaining.
     */
    useRoutes(routes) {
        this.#routes = routes.slice();
        return this;
    }

    /**
     * Assigns the authenticated user for downstream middleware and handlers.
     * @param {Object|null} user - User object for the current request, or null to clear it.
     * @returns {void}
     */
    setUser(user) {
        this.#user = user;
    }

    /**
     * Authenticated user associated with the current request.
     * @returns {Object|null} User object assigned by authentication middleware, or null.
     */
    get user() {
        return this.#user;
    }

    /**
     * Returns a registered service.
     * @param {string} name - Service identifier
     * @returns {Object} The registered instance
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When no service is registered under `name`
     */
    getService(name) {
        if (!isNonEmptyString(name)) {
            throw new AssertionError('Service name must be a non-empty string', null, this.getService);
        }
        if (!this.#services.has(name)) {
            throw new AssertionError(`The service "${ name }" is not registered`, null, this.getService);
        }
        return this.#services.get(name);
    }

    /**
     * Returns a registered collection.
     * @param {string} name - Collection identifier
     * @returns {Object} The registered Collection instance
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When no collection is registered under `name`
     */
    getCollection(name) {
        if (!isNonEmptyString(name)) {
            throw new AssertionError('Collection name must be a non-empty string', null, this.getCollection);
        }
        if (!this.#collections.has(name)) {
            throw new AssertionError(`The collection "${ name }" is not registered`, null, this.getCollection);
        }
        return this.#collections.get(name);
    }

    /**
     * Flattens every HttpTarget from every route in the current VirtualHost.
     * @returns {Array<HttpTarget>} Targets in route iteration order
     */
    getAllHttpTargets() {
        const targets = [];

        for (const route of this.#routes) {
            for (const target of route.targets) {
                targets.push(target);
            }
        }

        return targets;
    }

    /**
     * Looks up an HttpTarget by name across all routes (e.g. `Route/Target`).
     *
     * Returns the first match when names collide.
     *
     * @param {string} targetName - Fully-qualified target name
     * @returns {HttpTarget} The matching target
     * @throws {AssertionError} When targetName is not a non-empty string
     * @throws {AssertionError} When no target matches `targetName`
     */
    getHttpTarget(targetName) {
        if (!isNonEmptyString(targetName)) {
            throw new AssertionError('Target name must be a non-empty string', null, this.getHttpTarget);
        }

        for (const route of this.#routes) {
            for (const target of route.targets) {
                if (target.name === targetName) {
                    return target;
                }
            }
        }

        throw new AssertionError(`Target "${ targetName }" not found in current routes`, null, this.getHttpTarget);
    }

    /**
     * Returns HttpTargets that declare the given tag, in route iteration order.
     * @param {string} tag - Tag name to match
     * @returns {Array<HttpTarget>} Matching targets only; empty when none match
     * @throws {AssertionError} When tag is not a non-empty string
     */
    getHttpTargetsByTag(tag) {
        if (!isNonEmptyString(tag)) {
            throw new AssertionError('Target tag must be a non-empty string', null, this.getHttpTargetsByTag);
        }

        const targets = [];

        for (const route of this.#routes) {
            for (const target of route.targets) {
                if (target.hasTag(tag)) {
                    targets.push(target);
                }
            }
        }

        return targets;
    }
}
