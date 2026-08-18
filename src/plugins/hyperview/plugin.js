import HyperviewService from '../../kixx/hyperview/hyperview-service.js';


export function register(context) {
    const { logger } = context;
    context.registerService('Hyperview', new HyperviewService({ logger }));
}

export function initialize(context) {
    const kvStore = context.getService('KeyValueStore');
    const contentAddressableStore = context.getService('ContentAddressableStore');
    const hyperviewService = context.getService('Hyperview');
    hyperviewService.initialize({ kvStore, contentAddressableStore });
}
