import ObjectStore from './lib/object-store.js';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isPlainObject,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.OBJECT_STORE;
    assertNonEmptyString(
        storeConfig?.path,
        'node-object-store plugin requires context.config.env.OBJECT_STORE.path',
    );
    assert(
        isPlainObject(storeConfig?.buckets),
        'node-object-store plugin requires context.config.env.OBJECT_STORE.buckets',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-object-store plugin requires context.config.resolveFilepath',
    );

    const storePath = config.resolveFilepath(storeConfig.path);
    assertNonEmptyString(
        storePath,
        'node-object-store plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('ObjectStore', new ObjectStore({
        logger,
        path: storePath,
        buckets: storeConfig.buckets,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
