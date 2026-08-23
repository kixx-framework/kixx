// Plugins should make a best effort to avoid reaching into framework code
// for logic, but there are cases like this, when we should make an
// exception. The alternative is maintaining a wire FORMAT constant
// here, which would run the risk of critical drift.
import { FORMAT } from '../../kixx/content-addressable-store/addressing.js';
import ContentStore from './lib/content-store.js';
// Export the Cloudflare durable object.
export { default as ContentAddressableIndexStore } from './lib/content-addressable-index-store.js';


const DEFAULTS = {
    kvBindingName: 'CA_STORE_KV_STORE',
    durableObjectBindingName: 'CA_STORE_DURABLE_OBJECT',
    blobReadCacheTtlSeconds: 60 * 60 * 24,
    indexCacheTtlSeconds: 10,
};


export function register(context) {
    const { logger, config } = context;
    const {
        kvBindingName,
        durableObjectBindingName,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
    } = config.env.CONTENT_STORE ?? {};

    context.registerService('ContentStore', new ContentStore({
        logger,
        kvBindingName: kvBindingName ?? DEFAULTS.kvBindingName,
        durableObjectBindingName: durableObjectBindingName ?? DEFAULTS.durableObjectBindingName,
        wireFormat: FORMAT,
        blobReadCacheTtlSeconds: blobReadCacheTtlSeconds ?? DEFAULTS.blobReadCacheTtlSeconds,
        indexCacheTtlSeconds: indexCacheTtlSeconds ?? DEFAULTS.indexCacheTtlSeconds,
    }));
}
