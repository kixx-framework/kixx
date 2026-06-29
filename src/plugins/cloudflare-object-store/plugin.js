import ObjectStore from './lib/object-store.js';

export function register(context) {
    const { logger } = context;
    context.registerService('ObjectStore', new ObjectStore({ logger }));
}
