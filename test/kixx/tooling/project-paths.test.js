import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    listPluginContentRoots,
    renderRegistryFiles,
    resolveInstallation,
    validatePluginManifest,
    NODE_REGISTRY_FILE_NAME,
    CLOUDFLARE_REGISTRY_FILE_NAME,
} from '../../../kixx/tooling/mod.js';


function makeCore(overrides) {
    return validatePluginManifest(Object.assign({
        name: 'kixx',
        version: '7.0.0-alpha.0',
        description: 'Kixx core.',
        adapters: {
            node: {
                loggerWriter: './adapters/node/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/node/server-request/lib/server-request.js',
            },
            cloudflare: {
                loggerWriter: './adapters/cloudflare/logger-writer/lib/logger-writer.js',
                serverRequest: './adapters/cloudflare/server-request/lib/server-request.js',
            },
        },
    }, overrides), { file: 'kixx/plugin.json', isCore: true });
}

function makePlugin(name, overrides) {
    return validatePluginManifest(Object.assign({
        name,
        version: '7.0.0',
        core: '7.0.0',
        description: `The ${ name } plugin.`,
    }, overrides), { file: `plugins/${ name }/plugin.json`, directoryName: name });
}

function makeInstallation() {
    return resolveInstallation({
        core: makeCore(),
        plugins: [
            makePlugin('visits', {
                content: { pagesDirectory: './pages' },
                whenInstalled: {
                    admin: { content: { templatesDirectory: './admin/templates' } },
                    reports: { content: { pagesDirectory: './reports/pages' } },
                },
            }),
            makePlugin('admin', {
                content: {
                    pagesDirectory: './pages',
                    templatesDirectory: './templates',
                    staticAssetsDirectory: './static-assets',
                },
            }),
            makePlugin('quiet'),
        ],
    });
}

// Reads the value a generated registry assigns to `contentRoots`.
function readContentRootsExport(text) {
    const marker = 'export const contentRoots = ';
    const start = text.indexOf(marker) + marker.length;

    return text.slice(start, text.indexOf(';\n', start));
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('tooling: listPluginContentRoots()', ({ it }) => {
    it('lists each content root as paths from the project root, in installation order', () => {
        const roots = listPluginContentRoots(makeInstallation());

        assertEqual(JSON.stringify([
            {
                plugin: 'admin',
                pagesDirectory: 'plugins/admin/pages',
                templatesDirectory: 'plugins/admin/templates',
                staticAssetsDirectory: 'plugins/admin/static-assets',
            },
            { plugin: 'visits', pagesDirectory: 'plugins/visits/pages' },
            { plugin: 'visits', templatesDirectory: 'plugins/visits/admin/templates' },
        ]), JSON.stringify(roots));
    });

    it('returns an empty list when nothing declares content', () => {
        const installation = resolveInstallation({ core: makeCore(), plugins: [ makePlugin('quiet') ] });

        assertEqual('[]', JSON.stringify(listPluginContentRoots(installation)));
    });

    it('puts core\'s content under the core directory', () => {
        const installation = resolveInstallation({
            core: makeCore({ content: { templatesDirectory: './templates' } }),
            plugins: [],
        });

        assertEqual(
            JSON.stringify([ { plugin: 'kixx', templatesDirectory: 'kixx/templates' } ]),
            JSON.stringify(listPluginContentRoots(installation)),
        );
        assertEqual(
            JSON.stringify([ { plugin: 'kixx', templatesDirectory: 'vendor/kixx/templates' } ]),
            JSON.stringify(listPluginContentRoots(installation, { coreDirectory: 'vendor/kixx' })),
        );
    });

    // It only translates the path. The content compiler is what refuses a
    // root that leaves the project.
    it('translates a core directory outside the project without judging it', () => {
        const installation = resolveInstallation({
            core: makeCore({ content: { pagesDirectory: './pages' } }),
            plugins: [],
        });

        assertEqual(
            JSON.stringify([ { plugin: 'kixx', pagesDirectory: '../kixx/pages' } ]),
            JSON.stringify(listPluginContentRoots(installation, { coreDirectory: '../kixx' })),
        );
    });

    it('returns new records each time', () => {
        const installation = makeInstallation();
        const first = listPluginContentRoots(installation);

        first[0].pagesDirectory = 'changed';

        assertEqual('plugins/admin/pages', listPluginContentRoots(installation)[0].pagesDirectory);
    });

    it('is what both generated registries export as contentRoots', () => {
        const installation = makeInstallation();
        const options = { coreDirectory: '../../../kixx' };
        const expected = JSON.stringify(listPluginContentRoots(installation, options), null, 4);
        const files = renderRegistryFiles(installation, options);

        assertEqual(expected, readContentRootsExport(files.get(NODE_REGISTRY_FILE_NAME)));
        assertEqual(expected, readContentRootsExport(files.get(CLOUDFLARE_REGISTRY_FILE_NAME)));
    });

    it('rejects an unsafe core directory and a missing installation', () => {
        const absolute = catchError(() => listPluginContentRoots(makeInstallation(), { coreDirectory: '/kixx' }));

        assertEqual('AssertionError', absolute.name);
        assert(absolute.message.includes('options.coreDirectory must be a relative POSIX path'));

        const missing = catchError(() => listPluginContentRoots());

        assertEqual('AssertionError', missing.name);
        assert(missing.message.includes('installation must be a resolved installation'));
    });
});
