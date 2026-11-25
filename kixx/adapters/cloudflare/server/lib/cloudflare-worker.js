import { readConfig } from '../../../../config/read-config.js';
import HttpRouter from '../../../../http-router/http-router.js';
import ServerResponse from '../../../../http-router/server-response.js';
import { bootApplication } from '../../../../context/boot-application.js';
import TraceLogger from '../../../../logger/trace-logger.js';
import { assert, assertFunction, isObjectNotNull } from '../../../../assertions/mod.js';


/**
 * @typedef {Object} WorkerRegistry
 * @property {Function} LoggerWriter - Logger writer class for Cloudflare
 * @property {Function} ServerRequest - Server request class for Cloudflare
 * @property {Map<string, Object>} plugins - Lifecycle modules, in the order they run
 * @property {Object} configDefaults - Config defaults, merged under the selected environment's config
 * @property {{ required: string[], optional: string[] }} secrets - Every declared secret name
 */

/**
 * @typedef {Object} Worker
 * @property {function(Request, Object, { waitUntil: Function }): Promise<Response>} fetch - The Worker's fetch handler
 */


/**
 * Boots the application and returns the Worker's fetch handler. A Cloudflare
 * entry point calls it once, at module scope, and exports the result by
 * default.
 *
 * Booting happens here, during the Worker's startup: the config section for
 * `env.ENVIRONMENT` (or `development`) is read with the registry's defaults
 * under it, every declared secret is checked, and each lifecycle module is
 * registered and initialized. A failure throws, which fails the startup. A
 * Worker has no process lifetime, so start() and stop() hooks are never
 * called.
 *
 * The returned `fetch()` never throws. A request the router can't answer gets
 * a JSON:API 500, and the error is reported to the runtime through
 * `waitUntil()`.
 *
 * @param {Object} options
 * @param {Object} options.env - The module-scope environment the entry point imports from the Workers runtime
 * @param {Object} options.sourceConfig - The project's Cloudflare config, with an `environments` section
 * @param {WorkerRegistry} options.registry - The exports of the project's Cloudflare registry module
 * @param {Array<Object>} options.virtualHosts - Virtual host specifications for the router
 * @param {Object} options.app - The application's own lifecycle hooks
 * @param {function(number): Promise<void>} [options.wait] - Resolves after a number of milliseconds; defaults to the Workers scheduler
 * @returns {Worker}
 * @throws {OperationalError} When the config has no section for the environment, or a declared secret is missing
 */
export function createWorker(options) {
    const {
        env,
        sourceConfig,
        registry,
        virtualHosts,
        app,
        // The Workers scheduler is looked up when it is used, so this module
        // also loads where that global doesn't exist.
        wait = (milliseconds) => scheduler.wait(milliseconds),
    } = options ?? {};

    assert(isObjectNotNull(env), 'createWorker: options.env must be an object');
    assert(isObjectNotNull(registry), 'createWorker: options.registry must be a registry module');
    assertFunction(registry.ServerRequest, 'createWorker: options.registry.ServerRequest');
    assertFunction(wait, 'createWorker: options.wait');

    const { ServerRequest } = registry;

    // ENVIRONMENT selects which section of the source config is loaded, so it is
    // the one setting which cannot itself come from the config.
    const environment = env.ENVIRONMENT || 'development';
    const config = readConfig(sourceConfig, environment, { defaults: registry.configDefaults });

    const { appContext, logger } = bootApplication({
        env,
        config,
        LoggerWriter: registry.LoggerWriter,
        plugins: registry.plugins,
        app,
        secrets: registry.secrets,
    });

    const router = new HttpRouter(virtualHosts);

    // Key on `expected`, not `httpError`: a bug is fatal even when it carries an
    // HTTP status code. Expected HTTP errors (404, 422, ...) are routine and not logged.
    router.on('error', ({ error, requestId }) => {
        if (!error.expected) {
            logger.error('unexpected error while routing request', { requestId }, error);
        } else if (!error.httpError) {
            logger.warn('operational error while routing request', { requestId }, error);
        }
    });

    // requestEnvironment is the per-request env binding snapshot provided by the Workers runtime.
    // It may differ from the module-level `env` used at startup (e.g. in tail worker configurations).
    async function handleFetch(nativeRequest, requestEnvironment, cloudflare) {
        const trace = new TraceLogger(logger, 'http-fetch');
        let pathname;

        try {
            const request = new ServerRequest(nativeRequest);
            pathname = request.url.pathname;
            const requestContext = appContext.createRequestContext(requestEnvironment, request);

            const response = await router.handleRequest(requestContext, request, new ServerResponse());

            trace.ok({ pathname });

            return new Response(response.body, {
                status: response.status,
                headers: response.headers,
            });
        } catch (error) {
            logger.error('worker fetch error', null, error);

            // Report the failure to the Workers runtime without throwing out of fetch(). A
            // throw here would discard the response below and serve Cloudflare's own error
            // page instead, but simply returning a 500 would leave the invocation recorded
            // as a success: no exception event.
            // Rejecting a waitUntil() promise gives us both — the platform records the
            // exception with its stack, and the client still gets our response.
            cloudflare.waitUntil(waitToThrow(wait, 1000, error));

            // Last resort: the routing pipeline could not turn this error into a response.
            // mapErrorToJsonError() redacts the message of any error which is not a
            // public-safe HttpError, so nothing internal leaks.
            const payload = {
                errors: [ HttpRouter.mapErrorToJsonError(error) ],
            };

            trace.error({ pathname });

            return new Response(JSON.stringify(payload, null, 4), {
                status: 500,
                headers: {
                    'content-type': 'application/vnd.api+json',
                    // This response bypasses the router, which otherwise enforces the cache policy.
                    'cache-control': 'no-store',
                },
            });
        }
    }

    return { fetch: handleFetch };
}

async function waitToThrow(wait, milliseconds, error) {
    await wait(milliseconds);
    throw error;
}
