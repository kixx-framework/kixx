import DocumentStoreEngine from './lib/document-store-engine.js';

export function register(context) {
    const { logger } = context;
    const { path, sqliteOptions } = context.env.DOCUMENT_STORE ?? {};

    context.registerService('DocumentStoreEngine', new DocumentStoreEngine({
        logger,
        path,
        sqliteOptions,
    }));
}
