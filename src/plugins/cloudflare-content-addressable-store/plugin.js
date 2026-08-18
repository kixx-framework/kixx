import ContentAddressableStore from './lib/content-addressable-store.js';
// Export the Cloudflare durable object.
export { default as ContentAddressableIndexStore } from './lib/content-addressable-index-store.js';


const DEFAULTS = {
    kvBindingName: 'CA_STORE_KV_STORE',
    durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
    blobReadCacheTtlSeconds: 60 * 60 * 36,
    indexCacheTtlSeconds: 10,
};


export function register(context) {
    const { logger, config } = context;
    const {
        kvBindingName,
        durableObjectBindingName,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
    } = config?.env?.CONTENT_ADDRESSABLE_STORE ?? {};

    context.registerService('ContentAddressableStore', new ContentAddressableStore({
        logger,
        kvBindingName: kvBindingName ?? DEFAULTS.kvBindingName,
        durableObjectBindingName: durableObjectBindingName ?? DEFAULTS.durableObjectBindingName,
        blobReadCacheTtlSeconds: blobReadCacheTtlSeconds ?? DEFAULTS.blobReadCacheTtlSeconds,
        indexCacheTtlSeconds: indexCacheTtlSeconds ?? DEFAULTS.indexCacheTtlSeconds,
    }));
}
