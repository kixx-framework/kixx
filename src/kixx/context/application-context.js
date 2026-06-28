import RequestContext from './request-context.js';
import BaseContext from './base-context.js';
import {
    assert,
    assertNonEmptyString,
    assertDefined,
} from '../assertions/mod.js';


/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @typedef {import('./app-runtime.js').default} AppRuntime
 */


/**
 * Application-scoped context that owns the shared service and collection
 * registries and spawns a per-request RequestContext for each incoming request.
 *
 * One ApplicationContext exists for the lifetime of the process. It holds the
 * root logger, environment, and runtime metadata, and exposes registration and
 * lookup helpers for services and collections. The service and collection
 * registries it owns are shared by reference with every RequestContext it
 * creates, so registrations made here are visible to later requests.
 *
 * @extends BaseContext
 */
export default class ApplicationContext extends BaseContext {

    #services = new Map();
    #collections = new Map();

    /**
     * @param {Object} options
     * @param {Logger} options.logger - Root application logger shared with every request context.
     * @param {Object} options.env - Environment variables, secrets, and platform bindings.
     * @param {AppRuntime} options.runtime - Runtime metadata shared with every request context.
     */
    constructor(options) {
        const { env, logger, runtime } = options ?? {};
        super({ env, logger, runtime });
    }

    /**
     * Registers a service instance for later retrieval via getService().
     * @param {string} name - Service identifier for lookup
     * @param {Object} service - Service instance to register
     * @returns {ApplicationContext} This context instance for method chaining
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When service is undefined
     */
    registerService(name, service) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        assertDefined(service, `Service "${ name }" must be defined`);
        this.#services.set(name, service);
        return this;
    }

    /**
     * Returns a previously registered service.
     * @param {string} name - Service identifier (e.g. `kixx.Datastore`)
     * @returns {Object} The registered instance
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When no service is registered under `name`
     */
    getService(name) {
        assertNonEmptyString(name, 'Service name must be a non-empty string');
        assert(this.#services.has(name), `The service "${ name }" is not registered`);
        return this.#services.get(name);
    }

    /**
     * Registers a collection instance for later retrieval via getCollection().
     * @param {string} name - Collection identifier for lookup
     * @param {Object} collection - Collection instance to register
     * @returns {ApplicationContext} This context instance for method chaining
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When collection is undefined
     */
    registerCollection(name, collection) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        assertDefined(collection, `Collection "${ name }" must be defined`);
        this.#collections.set(name, collection);
        return this;
    }

    /**
     * Returns a previously registered collection.
     * @param {string} name - Collection identifier (e.g. `app.User`)
     * @returns {Object} The registered instance
     * @throws {AssertionError} When name is not a non-empty string
     * @throws {AssertionError} When no collection is registered under `name`
     */
    getCollection(name) {
        assertNonEmptyString(name, 'Collection name must be a non-empty string');
        assert(this.#collections.has(name), `The collection "${ name }" is not registered`);
        return this.#collections.get(name);
    }

    /**
     * Creates a RequestContext for an individual request.
     *
     * The request context receives the request-scoped environment while sharing
     * the application runtime, logger, services, and collections. When a request
     * is provided, its `id` becomes the new context's requestId.
     *
     * @param {Object} env - Request-scoped environment variables, secrets, and bindings
     * @param {import('../http-router/server-request-interface.js').ServerRequestInterface} [request]
     *   Request being handled by the context
     * @param {Object} [config] - Request-scoped application configuration.
     * @returns {RequestContext} Context for handling one request
     */
    createRequestContext(env, request, config) {
        return new RequestContext({
            env,
            config,
            requestId: request?.id,
            runtime: this.runtime,
            services: this.#services,
            collections: this.#collections,
            logger: this.logger,
        });
    }
}
