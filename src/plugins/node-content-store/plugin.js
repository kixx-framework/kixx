// This coordinated import avoids duplicating the content-addressing format
// constant in the Node adapter package.
import { FORMAT } from '../../kixx/content-addressable-store/addressing.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';
import ContentStore from './lib/content-store.js';


export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.CONTENT_STORE;
    assertNonEmptyString(
        storeConfig?.rootDirectory,
        'node-content-store plugin requires context.config.env.CONTENT_STORE.rootDirectory',
    );
    assertFunction(
        config?.resolveFilepath,
        'node-content-store plugin requires context.config.resolveFilepath',
    );

    const rootDirectory = config.resolveFilepath(storeConfig.rootDirectory);
    assertNonEmptyString(
        rootDirectory,
        'node-content-store plugin context.config.resolveFilepath() must return a non-empty string',
    );

    context.registerService('ContentStore', new ContentStore({
        logger,
        rootDirectory,
        format: FORMAT,
        sqliteOptions: storeConfig.sqliteOptions ?? {},
    }));
}
