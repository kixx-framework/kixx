import { assertNonEmptyString } from '../../kixx/assertions/mod.js';
import DocumentStoreEngine from './lib/document-store-engine.js';

export function register(context) {
    const { logger, config } = context;
    // Store settings live inside the selected environment, which readConfig
    // exposes as config.env.
    const { path, sqliteOptions } = config.env.DOCUMENT_STORE ?? {};

    assertNonEmptyString(path, 'The Node.js DOCUMENT_STORE.path config is required');

    // Pass in the absolute filepath for this OS
    const absoluteFilepath = config.resolveFilepath(path);

    logger.info('DocumentStoreEngine configured with filepath', { absoluteFilepath });

    context.registerService('DocumentStoreEngine', new DocumentStoreEngine({
        logger,
        path: absoluteFilepath,
        sqliteOptions,
    }));
}
