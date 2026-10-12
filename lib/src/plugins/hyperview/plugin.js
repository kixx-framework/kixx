// General plugin: pure framework logic with no platform variant of its own.

import HyperviewService from '../../kixx/hyperview/hyperview-service.js';


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

    context.registerService('HyperviewService', new HyperviewService({
        logger,
        useTemplateCache: useTemplateCache ?? DEFAULTS.useTemplateCache,
        usePageCache: usePageCache ?? DEFAULTS.usePageCache,
        pageCacheReadTtlSeconds: pageCacheReadTtlSeconds ?? DEFAULTS.pageCacheReadTtlSeconds,
        pageCacheExpirationSeconds: pageCacheExpirationSeconds ?? DEFAULTS.pageCacheExpirationSeconds,
        allowJsonResponse: allowJsonResponse ?? DEFAULTS.allowJsonResponse,
    }));
}

export function initialize(context) {
    const contentAddressableStore = context.getService('ContentAddressableStore');
    const kvStore = context.getService('KeyValueStore');
    const hyperviewService = context.getService('HyperviewService');
    hyperviewService.initialize({ kvStore, contentAddressableStore });
}
