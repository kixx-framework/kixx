import StaticFileServerStore from './lib/static-file-server-store.js';

export function register(context) {
    const { logger } = context;
    const { directory } = context.env.STATIC_FILE_STORE ?? {};
    context.registerService('StaticFileServerStore', new StaticFileServerStore({ logger, directory }));
}
