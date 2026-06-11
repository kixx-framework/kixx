import DocumentStoreEngine from './lib/document-store-engine.js';

export function register(context) {
    const { logger } = context;
    context.registerService('DocumentStoreEngine', new DocumentStoreEngine({ logger }));
}
