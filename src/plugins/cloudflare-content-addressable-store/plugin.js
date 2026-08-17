import ContentAddressableStore from './lib/content-addressable-store.js';


const DEFAULTS = {
    kvBindingName: 'CONTENT_ADDRESSABLE_STORE',
    durableObjectNamespace: 'CONTENT_ADDRESSABLE_STORE',
    blobReadCacheTtlSeconds: 60 * 60 * 36,
    indexCacheTtlSeconds: 10,
};


export function register(context) {
    const { logger, config } = context;
    const {
        kvBindingName,
        durableObjectNamespace,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
    } = config?.env?.CONTENT_ADDRESSABLE_STORE ?? {};

    context.registerService('ContentAddressableStore', new ContentAddressableStore({
        logger,
        kvBindingName: kvBindingName ?? DEFAULTS.kvBindingName,
        durableObjectNamespace: durableObjectNamespace ?? DEFAULTS.durableObjectNamespace,
        blobReadCacheTtlSeconds: blobReadCacheTtlSeconds ?? DEFAULTS.blobReadCacheTtlSeconds,
        indexCacheTtlSeconds: indexCacheTtlSeconds ?? DEFAULTS.indexCacheTtlSeconds,
    }));
}
