import ContentAddressableStore from './lib/content-addressable-store.js';


const DEFAULTS = {
    kvBindingName: 'CA_STORE_KV_STORE',
    d1BindingName: 'CA_STORE_D1_DB',
    durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
    blobReadCacheTtlSeconds: 60 * 60 * 36,
    indexCacheTtlSeconds: 10,
};


export function register(context) {
    const { logger, config } = context;
    const {
        kvBindingName,
        d1BindingName,
        durableObjectBindingName,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
    } = config?.env?.CONTENT_ADDRESSABLE_STORE ?? {};

    context.registerService('ContentAddressableStore', new ContentAddressableStore({
        logger,
        d1BindingName: d1BindingName ?? DEFAULTS.d1BindingName,
        kvBindingName: kvBindingName ?? DEFAULTS.kvBindingName,
        durableObjectBindingName: durableObjectBindingName ?? DEFAULTS.durableObjectBindingName,
        blobReadCacheTtlSeconds: blobReadCacheTtlSeconds ?? DEFAULTS.blobReadCacheTtlSeconds,
        indexCacheTtlSeconds: indexCacheTtlSeconds ?? DEFAULTS.indexCacheTtlSeconds,
    }));
}
