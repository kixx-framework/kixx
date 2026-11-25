// Plugins should make a best effort to avoid reaching into framework code
// for logic, but there are cases like this, when we should make an
// exception. The alternative is maintaining a wire-format constant
// here, which would run the risk of critical drift.
import { FORMAT } from '../../../content-addressable-store/addressing.js';
import { assertNonEmptyString, assertNumberNotNaN } from '../../../assertions/mod.js';
import ContentStore from './lib/content-store.js';


const CONFIG_PATH = 'context.config.env.CONTENT_STORE';


export function register(context) {
    const { logger, config } = context;

    // Core's manifest gives every value here a default, merged under the
    // project's config before boot. A missing one means the registry's
    // defaults were not passed to readConfig().
    const storeConfig = config?.env?.CONTENT_STORE;
    const kvBindingName = storeConfig?.kvNamespace?.bindingName;
    const durableObjectBindingName = storeConfig?.durableObject?.bindingName;
    const blobReadCacheTtlSeconds = storeConfig?.blobReadCacheTtlSeconds;
    const indexCacheTtlSeconds = storeConfig?.indexCacheTtlSeconds;

    assertNonEmptyString(
        kvBindingName,
        `cloudflare content store requires ${ CONFIG_PATH }.kvNamespace.bindingName`,
    );
    assertNonEmptyString(
        durableObjectBindingName,
        `cloudflare content store requires ${ CONFIG_PATH }.durableObject.bindingName`,
    );
    assertNumberNotNaN(
        blobReadCacheTtlSeconds,
        `cloudflare content store requires ${ CONFIG_PATH }.blobReadCacheTtlSeconds`,
    );
    assertNumberNotNaN(
        indexCacheTtlSeconds,
        `cloudflare content store requires ${ CONFIG_PATH }.indexCacheTtlSeconds`,
    );

    context.registerService('ContentStore', new ContentStore({
        logger,
        kvBindingName,
        durableObjectBindingName,
        wireFormat: FORMAT,
        blobReadCacheTtlSeconds,
        indexCacheTtlSeconds,
        // The Workers scheduler is looked up when a retry waits, not when the
        // store is built. Reading the global here, at registration, would
        // throw wherever it doesn't exist, as in a unit test.
        scheduler: { wait: (milliseconds) => scheduler.wait(milliseconds) },
    }));
}
