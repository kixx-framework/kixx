import StaticFileStore from './lib/static-file-server-store.js';

export function register(context) {
    const { logger } = context;
    context.registerService('StaticFileStore', new StaticFileStore({ logger }));
}
