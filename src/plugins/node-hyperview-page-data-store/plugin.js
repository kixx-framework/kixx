import PageDataStore from './lib/page-data-store.js';

export function register(context) {
    const { logger } = context;
    context.registerService('HyperviewPageDataStore', new PageDataStore({ logger }));
}
