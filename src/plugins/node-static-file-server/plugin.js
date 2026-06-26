import { assertNonEmptyString } from '../../kixx/assertions/mod.js';
import StaticFileServerStore from './lib/static-file-server-store.js';

export function register(context) {
    const { logger, config } = context;
    const { directory } = config.env.STATIC_FILE_STORE ?? {};

    assertNonEmptyString(directory, 'The Node.js STATIC_FILE_STORE.directory config is required');

    // Pass in the absolute filepath for this OS
    const absoluteFilepath = config.resolveFilepath(directory);

    logger.info('StaticFileServerStore configured with filepath', { absoluteFilepath });

    context.registerService('StaticFileServerStore', new StaticFileServerStore({
        logger,
        directory: absoluteFilepath,
    }));
}
