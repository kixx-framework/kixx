import { env } from 'cloudflare:workers';
import sourceConfig from './cloudflare-config.js';
import { readConfig } from './kixx/config/read-config.js';
import HttpRouter from './kixx/http-router/http-router.js';
import LoggerWriter from './plugins/cloudflare-logger-writer/lib/logger-writer.js';
import ServerRequest from './plugins/cloudflare-server-request/lib/server-request.js';
import ServerResponse from './kixx/http-router/server-response.js';
import { bootApplication } from './kixx/context/boot-application.js';
import * as app from './app/app.js';
import { plugins as generalPlugins } from './plugins/general.js';
import { plugins as cloudflarePlugins, durableObjects } from './plugins/cloudflare.js';
import { mergePluginMaps } from './plugins/merge-plugin-maps.js';
import virtualHosts from './virtual-hosts.js';

// ENVIRONMENT selects which section of the source config is loaded, so it is
// the one setting which cannot itself come from the config.
const environment = env.ENVIRONMENT || 'development';
const config = readConfig(sourceConfig, environment);

// Merge plugin maps, allowing platform plugins to override general plugins.
const plugins = mergePluginMaps(generalPlugins, cloudflarePlugins);

const { appContext, logger } = bootApplication({
    env,
    config,
    LoggerWriter,
    plugins,
    app,
});

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

// Export the Cloudflare Durable Objects which are part of this Worker.
export const { ContentAddressableIndexStore } = durableObjects;

export default {
    // requestEnvironment is the per-request env binding snapshot provided by the Workers runtime.
    // It may differ from the module-level `env` used at startup (e.g. in tail worker configurations).
    async fetch(nativeRequest, requestEnvironment, _cloudflare) {
        try {
            const request = new ServerRequest(nativeRequest);
            const requestContext = appContext.createRequestContext(requestEnvironment, request);

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
