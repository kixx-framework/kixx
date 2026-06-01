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


export default class ApplicationContext extends BaseContext {

    #services = new Map();
    #collections = new Map();

    /**
     * @param {Object} options
     * @param {import('../logger/logger.js').default} options.logger
     * @param {Object} options.env
     * @param {import('./app-runtime.js').default} options.runtime
     */
    constructor(options) {
        super();

        const {
            logger,
            env,
            runtime,
        } = options ?? {};

        Object.defineProperties(this, {
            /**
             * Accessor for environment variables, secrets, and bindings.
             * @name env
             * @type {Object}
             */
            env: { value: env, enumerable: true },
            /**
             * Root application logger.
             * @name logger
             * @type {import('../logger/logger.js').default}
             */
            logger: { value: logger, enumerable: true },
            /**
             * Runtime metadata indicating whether the application is serving HTTP
             * requests or executing a CLI command.
             * @name runtime
             * @type {import('./app-runtime.js').default}
             */
            runtime: { value: runtime, enumerable: true },
        });
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
     * the application runtime, logger, services, and collections.
     *
     * @param {Object} env - Request-scoped environment variables, secrets, and bindings
     * @param {import('../http-router/server-request-interface.js').ServerRequestInterface} [request]
     *   Request being handled by the context
     * @returns {RequestContext} Context for handling one request
     */
    createRequestContext(env, request) {
        return new RequestContext({
            env,
            requestId: request?.id,
            runtime: this.runtime,
            services: this.#services,
            collections: this.#collections,
            logger: this.logger,
        });
    }
}
