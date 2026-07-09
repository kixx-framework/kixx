import PageDataStore from './lib/page-data-store.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.HYPERVIEW_PAGE_DATA_STORE;
    assertNonEmptyString(
        storeConfig?.directory,
        'node-hyperview-page-data-store plugin requires context.config.env.HYPERVIEW_PAGE_DATA_STORE.directory',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-hyperview-page-data-store plugin requires context.config.resolveFilepath',
    );

    const directory = config.resolveFilepath(storeConfig.directory);
    assertNonEmptyString(
        directory,
        'node-hyperview-page-data-store plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('HyperviewPageDataStore', new PageDataStore({
        logger,
        directory,
    }));
}
