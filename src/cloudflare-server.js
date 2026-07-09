import { env } from 'cloudflare:workers';
import sourceConfig from './cloudflare-config.js';
import { readConfig } from './plugins/cloudflare-config/lib/config.js';
import Logger from './kixx/logger/logger.js';
import ApplicationContext from './kixx/context/application-context.js';
import AppRuntime from './kixx/context/app-runtime.js';
import HttpRouter from './kixx/http-router/http-router.js';
import LoggerWriter from './plugins/cloudflare-logger-writer/lib/logger-writer.js';
import ServerRequest from './plugins/cloudflare-server-request/lib/server-request.js';
import ServerResponse from './kixx/http-router/server-response.js';
import { isFunction } from './kixx/assertions/mod.js';
import * as app from './app/app.js';
import generalPlugins from './plugins/general.js';
import cloudflarePlugins from './plugins/cloudflare.js';
import virtualHosts from './virtual-hosts.js';

const environment = env.ENVIRONMENT || 'development';
const serverConfig = readConfig(sourceConfig, environment);
const name = env.APP_NAME || 'kixx-app';

const runtime = new AppRuntime({
    build: { id: env.BUILD_ID },
    server: { name },
});

const logger = new Logger({
    name,
    level: env.LOG_LEVEL || 'debug',
    writer: new LoggerWriter(),
});

const appContext = new ApplicationContext({
    env,
    runtime,
    logger,
});

// Merge plugin maps, allowing platform plugins to override general plugins.
const plugins = new Map([ ...generalPlugins, ...cloudflarePlugins ]);

// Register all plugins before calling initialize() on each.
for (const plugin of plugins.values()) {
    if (isFunction(plugin?.register)) {
        plugin.register(appContext);
    }
}

for (const plugin of plugins.values()) {
    if (isFunction(plugin?.initialize)) {
        plugin.initialize(appContext);
    }
}

if (isFunction(app.register)) {
    app.register(appContext);
}

if (isFunction(app.initialize)) {
    app.initialize(appContext);
}

// Finalize the logger to prevent creating infinite child loggers.
// This must be done *after* the plugins have been registered and initialized.
logger.finalize();

const router = new HttpRouter(virtualHosts);

router.on('error', ({ error, requestId }) => {
    if (!error.httpError) {
        if (error.expected) {
            // Operational Error
            logger.warn('operational error while routing request', { requestId }, error);
        } else {
            logger.error('unexpected error while routing request', { requestId }, error);
        }
    }
});

export default {
    // requestEnvironment is the per-request env binding snapshot provided by the Workers runtime.
    // It may differ from the module-level `env` used at startup (e.g. in tail worker configurations).
    async fetch(nativeRequest, requestEnvironment, _cloudflare) {
        try {
            const request = new ServerRequest(nativeRequest);
            const requestContext = appContext.createRequestContext(requestEnvironment, request, serverConfig);

            const response = await router.handleRequest(requestContext, request, new ServerResponse());

            return new Response(response.body, {
                status: response.status,
                headers: response.headers,
            });
        } catch (error) {
            logger.error('worker fetch error', null, error);
            throw error;
        }
    },
};
