// This coordinated import avoids duplicating the content-addressing format
// constant in the Node adapter package.
import { FORMAT } from '../../../content-addressable-store/addressing.js';
import {
    assertFunction,
    assertNonEmptyString,
} from '../../../assertions/mod.js';
import ContentStore from './lib/content-store.js';


/**
 * Registers the content store, in every environment, from
 * `CONTENT_STORE.rootDirectory`. A development server stores what is published
 * to it here too, while its pages render from the working tree.
 *
 * @param {Object} context - The application context
 * @returns {void}
 * @throws {AssertionError} When `CONTENT_STORE.rootDirectory` or `config.resolveFilepath` is missing
 */
export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.CONTENT_STORE;
    assertFunction(
        config?.resolveFilepath,
        'node-content-store plugin requires context.config.resolveFilepath',
    );

    assertNonEmptyString(
        storeConfig?.rootDirectory,
        'node-content-store plugin requires context.config.env.CONTENT_STORE.rootDirectory',
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
