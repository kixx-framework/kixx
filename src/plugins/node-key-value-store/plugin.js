import KeyValueStore from './lib/key-value-store.js';

export function register(context) {
    const { logger } = context;
    context.registerService('KeyValueStore', new KeyValueStore({ logger }));
}
