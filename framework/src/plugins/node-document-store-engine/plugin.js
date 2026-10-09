import DocumentStoreEngine from './lib/document-store-engine.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.DOCUMENT_STORE;
    assertNonEmptyString(
        storeConfig?.path,
        'node-document-store-engine plugin requires context.config.env.DOCUMENT_STORE.path',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-document-store-engine plugin requires context.config.resolveFilepath',
    );

    const storePath = config.resolveFilepath(storeConfig.path);
    assertNonEmptyString(
        storePath,
        'node-document-store-engine plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('DocumentStoreEngine', new DocumentStoreEngine({
        logger,
        path: storePath,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
