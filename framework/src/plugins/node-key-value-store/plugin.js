import KeyValueStore from './lib/key-value-store.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.KEY_VALUE_STORE;
    assertNonEmptyString(
        storeConfig?.path,
        'node-key-value-store plugin requires context.config.env.KEY_VALUE_STORE.path',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-key-value-store plugin requires context.config.resolveFilepath',
    );

    const storePath = config.resolveFilepath(storeConfig.path);
    assertNonEmptyString(
        storePath,
        'node-key-value-store plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('KeyValueStore', new KeyValueStore({
        logger,
        path: storePath,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
