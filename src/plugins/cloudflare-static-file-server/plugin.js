import StaticFileServerStore from './lib/static-file-server-store.js';

export function register(context) {
    const { logger } = context;
    // The Static Assets binding is request-scoped, so the store resolves it from
    // the request context per call rather than at registration time.
    context.registerService('StaticFileServerStore', new StaticFileServerStore({ logger }));
}
