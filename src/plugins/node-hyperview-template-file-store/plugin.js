import TemplateFileStore from './lib/template-file-store.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.HYPERVIEW_TEMPLATE_FILE_STORE;
    assertNonEmptyString(
        storeConfig?.directory,
        'node-hyperview-template-file-store plugin requires context.config.env.HYPERVIEW_TEMPLATE_FILE_STORE.directory',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-hyperview-template-file-store plugin requires context.config.resolveFilepath',
    );

    const directory = config.resolveFilepath(storeConfig.directory);
    assertNonEmptyString(
        directory,
        'node-hyperview-template-file-store plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('HyperviewTemplateFileStore', new TemplateFileStore({
        logger,
        directory,
    }));
}
