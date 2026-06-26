import { assertNonEmptyString } from '../../kixx/assertions/mod.js';
import TemplateFileStore from './lib/template-file-store.js';

export function register(context) {
    const { logger, config } = context;

    // Store settings live inside the selected environment, which readConfig
    // exposes as config.env.
    const { directory } = config.env.TEMPLATE_FILE_STORE ?? {};

    assertNonEmptyString(directory, 'The Node.js TEMPLATE_FILE_STORE.directory config is required');

    // Pass in the absolute filepath for this OS
    const absolutePath = config.resolveFilepath(directory);

    logger.info('HyperviewTemplateFileStore configured with directory', { absolutePath });

    context.registerService('HyperviewTemplateFileStore', new TemplateFileStore({
        logger,
        directory: absolutePath,
    }));
}
