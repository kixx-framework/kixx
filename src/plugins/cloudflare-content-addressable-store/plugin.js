import CloudflareContentStore from './lib/cloudflare-content-store.js';
// Export the Cloudflare durable object.
export { default as ContentAddressableIndexStore } from './lib/content-addressable-index-store.js';


const DEFAULTS = {
    kvBindingName: 'CA_STORE_KV_STORE',
    durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
    blobReadCacheTtlSeconds: 60 * 60 * 24,
    indexCacheTtlSeconds: 10,
};


// Registers the generic content-addressable store. This plugin's public
// surface is a generic content-addressable store: immutable blob storage, an
// immutable index, and the digest wire format. No Hyperview vocabulary (page,
// template, or bundle) belongs here — that content model lives in
// `src/kixx/hyperview/` and is consumed through this service.
export function register(context) {
    const { logger, config } = context;
    const {
        kvBindingName,
        durableObjectBindingName,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
    } = config.env.CONTENT_ADDRESSABLE_STORE ?? {};

    const store = new CloudflareContentStore({
        logger,
        kvBindingName: kvBindingName ?? DEFAULTS.kvBindingName,
        durableObjectBindingName: durableObjectBindingName ?? DEFAULTS.durableObjectBindingName,
        blobReadCacheTtlSeconds: blobReadCacheTtlSeconds ?? DEFAULTS.blobReadCacheTtlSeconds,
        indexCacheTtlSeconds: indexCacheTtlSeconds ?? DEFAULTS.indexCacheTtlSeconds,
    });

    context.registerService('ContentAddressableStore', store);
}
