import KeyValueStore from './lib/key-value-store.js';

export function register(context) {
    const { logger } = context;
    const { path, sqliteOptions } = context.env.KEY_VALUE_STORE ?? {};

    context.registerService('KeyValueStore', new KeyValueStore({
        logger,
        path,
        sqliteOptions,
    }));
}
