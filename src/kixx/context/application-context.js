import RequestContext from './request-context.js';
import BaseContext from './base-context.js';
import {
    assert,
    isFunction,
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
    #closed = false;

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

    /**
     * Closes registered services that expose a `close()` method, releasing
     * resources such as open database connections during process shutdown.
     *
     * Services are closed in reverse registration order (LIFO) so a service is
     * torn down before the services it was built on top of. Each close is
     * awaited and isolated: a failure is logged and the sweep continues, so one
     * throwing or stuck service cannot strand the others. Calling more than once
     * is a no-op.
     *
     * Only services are swept. Connection-owning stores register as services,
     * and each store's own `close()` is idempotent, so closing a wrapper service
     * and its underlying engine service in turn is safe.
     *
     * @async
     * @returns {Promise<void>}
     */
    async close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;

        // Reverse registration order so a service is torn down before the
        // services it depends on (e.g. a store wrapper before its engine).
        const entries = [ ...this.#services ].reverse();

        for (const [ name, service ] of entries) {
            if (!isFunction(service?.close)) {
                continue;
            }

            try {
                // Await each close so an async teardown (network flush, final
                // checkpoint) completes before the process exits.
                await service.close();
            } catch (cause) {
                // Isolate failures: one service that throws must not prevent the
                // remaining services from closing.
                this.logger.error('error closing service during shutdown', { name }, cause);
            }
        }
    }
}
