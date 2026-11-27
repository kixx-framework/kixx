// Core registration: pure framework logic with no platform variant of its own.

import { assert, isPlainObject } from '../assertions/mod.js';
import HyperviewService from './hyperview-service.js';


export function register(context) {
    const { logger, config } = context;

    // Core's manifest holds the defaults, and they are merged under the
    // project's config before boot. So the block is always here, complete.
    assert(
        isPlainObject(config?.env?.HYPERVIEW),
        'hyperview plugin requires context.config.env.HYPERVIEW to be a plain object',
    );

    const {
        useTemplateCache,
        usePageCache,
        pageCacheReadTtlSeconds,
        pageCacheExpirationSeconds,
        allowJsonResponse,
    } = config.env.HYPERVIEW;

    context.registerService('HyperviewService', new HyperviewService({
        logger,
        useTemplateCache,
        usePageCache,
        pageCacheReadTtlSeconds,
        pageCacheExpirationSeconds,
        allowJsonResponse,
    }));
}

export function initialize(context) {
    const contentAddressableStore = context.getService('ContentAddressableStore');
    // The KV store holds only the rendered-page cache, so Hyperview runs
    // without one when the page cache is off (CORE-6).
    const kvStore = context.hasService('KeyValueStore')
        ? context.getService('KeyValueStore')
        : null;
    const hyperviewService = context.getService('HyperviewService');
    hyperviewService.initialize({ kvStore, contentAddressableStore });
}
