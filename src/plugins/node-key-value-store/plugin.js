import { assertNonEmptyString } from '../../kixx/assertions/mod.js';
import KeyValueStore from './lib/key-value-store.js';

export function register(context) {
    const { logger, config } = context;

    // Store settings live inside the selected environment, which readConfig
    // exposes as config.env.
    const { path, sqliteOptions } = config.env.KEY_VALUE_STORE ?? {};

    assertNonEmptyString(path, 'The Node.js KEY_VALUE_STORE.path config is required');

    context.registerService('KeyValueStore', new KeyValueStore({
        logger,
        // Pass in the absolute filepath for this OS
        path: config.resolveFilepath(path),
        sqliteOptions,
    }));
}
