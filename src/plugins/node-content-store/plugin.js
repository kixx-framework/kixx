// This coordinated import avoids duplicating the content-addressing format
// constant in the Node adapter package.
import { FORMAT } from '../../kixx/content-addressable-store/addressing.js';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
} from '../../kixx/assertions/mod.js';
import ContentStore from './lib/content-store.js';
import DeveloperContentStore from './lib/developer-content-store.js';

const DEFAULT_SOURCE_DIRECTORIES = {
    pagesDirectory: './src/pages',
    templatesDirectory: './src/templates',
    staticAssetsDirectory: './src/static-assets',
    emailsDirectory: './src/emails',
};


export function register(context) {
    const { config, logger } = context;
    const storeConfig = config?.env?.CONTENT_STORE;
    assertFunction(
        config?.resolveFilepath,
        'node-content-store plugin requires context.config.resolveFilepath',
    );

    if (storeConfig?.developerMode === true) {
        assertNonEmptyString(
            config.environment,
            'node-content-store plugin developer mode requires context.config.environment',
        );
        assert(
            config.environment === 'development',
            'node-content-store plugin developer mode is restricted to the development environment',
        );

        const sourceDirectories = {};
        for (const [ name, defaultPath ] of Object.entries(DEFAULT_SOURCE_DIRECTORIES)) {
            sourceDirectories[name] = resolvePath(config, storeConfig[name] ?? defaultPath, name);
        }
        context.registerService('ContentStore', new DeveloperContentStore({
            logger,
            ...sourceDirectories,
        }));
        return;
    }

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

function resolvePath(config, configuredPath, name) {
    assertNonEmptyString(
        configuredPath,
        `node-content-store plugin requires a non-empty CONTENT_STORE.${ name }`,
    );
    const resolvedPath = config.resolveFilepath(configuredPath);
    assertNonEmptyString(
        resolvedPath,
        'node-content-store plugin context.config.resolveFilepath() must return a non-empty string',
    );
    return resolvedPath;
}
