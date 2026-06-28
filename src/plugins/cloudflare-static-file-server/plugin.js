import StaticFileStore from './lib/static-file-server-store.js';

export function register(context) {
    const { logger, config } = context;

    // The dedicated KV binding is request-scoped, so the store resolves it from the
    // request context per call. Only its name is needed at registration time; an
    // absent config name lets the store fall back to its default binding name.
    const { bindingName } = config?.env?.STATIC_FILE_STORE ?? {};

    context.registerService('StaticFileStore', new StaticFileStore({ logger, bindingName }));
}
