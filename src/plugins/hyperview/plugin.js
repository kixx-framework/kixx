// General plugin: pure framework logic with no platform variant of its own.
// It registers and wires the two Hyperview services in a fixed order —
// HyperviewContentService, then HyperviewService, which depends on it.
//
// HyperviewContentService is implemented entirely over the generic
// `ContentAddressableStore` port (see agents/plans/hyperview-content-service.md),
// so this plugin restricts Hyperview to whichever platform registers that
// service. Today only `src/plugins/cloudflare.js` does, through
// `cloudflare-content-addressable-store`; `src/plugins/node.js` registers no
// content-addressable store, so the general Hyperview plugin cannot
// initialize on the Node target yet. A future Node adapter must implement
// `src/kixx/content-store/content-addressable-store-interface.js` and
// register itself as `ContentAddressableStore` to close this gap.
import HyperviewService from '../../kixx/hyperview/hyperview-service.js';
import HyperviewContentService from '../../kixx/hyperview/hyperview-content-service.js';


const DEFAULTS = {
    useTemplateCache: false,
    usePageCache: false,
    pageCacheReadTtlSeconds: 60 * 60 * 24,
    pageCacheExpirationSeconds: 60 * 60 * 24,
    allowJsonResponse: false,
};


export function register(context) {
    const { logger, config } = context;

    const {
        useTemplateCache,
        usePageCache,
        pageCacheReadTtlSeconds,
        pageCacheExpirationSeconds,
        allowJsonResponse,
    } = config.env.HYPERVIEW ?? {};

    context.registerService('HyperviewContent', new HyperviewContentService());

    context.registerService('Hyperview', new HyperviewService({
        logger,
        useTemplateCache: useTemplateCache ?? DEFAULTS.useTemplateCache,
        usePageCache: usePageCache ?? DEFAULTS.usePageCache,
        pageCacheReadTtlSeconds: pageCacheReadTtlSeconds ?? DEFAULTS.pageCacheReadTtlSeconds,
        pageCacheExpirationSeconds: pageCacheExpirationSeconds ?? DEFAULTS.pageCacheExpirationSeconds,
        allowJsonResponse: allowJsonResponse ?? DEFAULTS.allowJsonResponse,
    }));
}

export function initialize(context) {
    const contentStore = context.getService('ContentAddressableStore');
    const hyperviewContent = context.getService('HyperviewContent');
    hyperviewContent.initialize({ contentStore });

    const kvStore = context.getService('KeyValueStore');
    const hyperviewService = context.getService('Hyperview');
    hyperviewService.initialize({ kvStore, contentService: hyperviewContent });
}
