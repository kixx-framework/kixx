import PageDataStore from './lib/page-data-store.js';

export function register(context) {
    const { logger } = context;
    const { directory } = context.env.PAGE_DATA_STORE ?? {};
    context.registerService('HyperviewPageDataStore', new PageDataStore({ logger, directory }));
}
