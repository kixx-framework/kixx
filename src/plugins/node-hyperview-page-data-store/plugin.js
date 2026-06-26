import { assertNonEmptyString } from '../../kixx/assertions/mod.js';
import PageDataStore from './lib/page-data-store.js';

export function register(context) {
    const { logger, config } = context;
    // Store settings live inside the selected environment, which readConfig
    // exposes as config.env.
    const { directory } = config.env.PAGE_DATA_STORE ?? {};

    assertNonEmptyString(directory, 'The Node.js PAGE_DATA_STORE.directory config is required');

    // Pass in the absolute filepath for this OS
    const absolutePath = config.resolveFilepath(directory);

    logger.info('HyperviewPageDataStore configured with directory', { absolutePath });

    context.registerService('HyperviewPageDataStore', new PageDataStore({
        logger,
        directory: absolutePath,
    }));
}
