import StaticFileStore from './lib/static-file-server-store.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';

export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.STATIC_FILE_STORE;
    assertNonEmptyString(
        storeConfig?.directory,
        'node-static-file-server plugin requires context.config.env.STATIC_FILE_STORE.directory',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-static-file-server plugin requires context.config.resolveFilepath',
    );

    const directory = config.resolveFilepath(storeConfig.directory);
    assertNonEmptyString(
        directory,
        'node-static-file-server plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('StaticFileStore', new StaticFileStore({
        logger,
        directory,
    }));
}
