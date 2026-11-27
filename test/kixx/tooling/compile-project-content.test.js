import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    compileContent,
    compileProjectContent,
    serializeContentObject,
} from '../../../kixx/tooling/mod.js';
import * as tooling from '../../../kixx/tooling/mod.js';
import * as contentCompiler from '../../../kixx/content-compiler/mod.js';
import { createMemoryContentSource } from '../../../kixx/content-compiler/memory-content-source.js';


const CORE_MANIFEST = {
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
    templateHelpers: [ 'if', 'unescape' ],
};

const VISITS_MANIFEST = {
    name: 'visits',
    version: '7.0.0',
    core: '7.0.0',
    description: 'Counts visits.',
    content: { pagesDirectory: './pages', templatesDirectory: './templates' },
    templateHelpers: [ 'visitCount' ],
};

const APP_MANIFEST = {
    templateHelpers: [ 'greeting' ],
};

// One project: its own page and base template, and a plugin's page and
// global partial. The templates use a helper from each of core, the plugin,
// and the app, each with an argument, so every declaration is needed.
function makeFiles(overrides) {
    return Object.assign({
        'kixx/plugin.json': JSON.stringify(CORE_MANIFEST),
        'plugins/visits/plugin.json': JSON.stringify(VISITS_MANIFEST),
        'app/app.json': JSON.stringify(APP_MANIFEST),
        'pages/page.json': JSON.stringify({ template: 'page.html' }),
        'pages/page.html': '<h1>{{greeting page.title}}</h1>{{> visits/total.html }}',
        'templates/base/default.html': '<html>{{unescape content}}</html>',
        'plugins/visits/pages/visits/page.json': JSON.stringify({ template: 'page.html' }),
        'plugins/visits/pages/visits/page.html': '<p>{{visitCount page.pathname}}</p>',
        'plugins/visits/templates/partials/visits/total.html': '<p>{{#if total}}{{ total }}{{/if}}</p>',
    }, overrides);
}

// An in-memory ProjectFileSystemInterface and content source over one set
// of files. Every call to either is recorded in `calls`, in order.
function makeProject(files) {
    const calls = [];
    const memory = createMemoryContentSource(files);

    const fileSystem = {
        async readTextFile(path) {
            calls.push(`manifest ${ path }`);
            return Object.hasOwn(files, path) ? files[path] : null;
        },

        async listDirectories(path) {
            const names = new Set();

            for (const file of Object.keys(files)) {
                const rest = file.startsWith(`${ path }/`) ? file.slice(path.length + 1).split('/') : [];

                if (rest.length > 1) {
                    names.add(rest[0]);
                }
            }

            return Array.from(names).sort();
        },
    };

    const source = {
        async listFiles(directory) {
            calls.push(`list ${ directory }`);
            return await memory.listFiles(directory);
        },

        async readFile(path) {
            calls.push(`read ${ path }`);
            return await memory.readFile(path);
        },
    };

    return { fileSystem, source, calls };
}

async function compileProject(files, coreDirectory) {
    const { fileSystem, source, calls } = makeProject(files);
    const compilation = await compileProjectContent({ fileSystem, source, coreDirectory });

    return { compilation, calls };
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

function contentCalls(calls) {
    return calls.filter((call) => !call.startsWith('manifest '));
}


describe('tooling: compileProjectContent()', ({ it }) => {
    it('compiles the project\'s content and its plugins\' into one Release', async () => {
        const { compilation } = await compileProject(makeFiles());
        const { release, report, objects, graph } = compilation;

        assertEqual('[]', JSON.stringify(report.problems));
        assertEqual('/,/visits', Object.keys(release.manifest.pages).join());
        assert(release.manifest.globalTemplatePartials, 'expected the plugin\'s global partial in the manifest');

        const pluginTemplate = objects.find(({ type, pathname }) => {
            return type === 'PageTemplate' && pathname === '/visits/page.html';
        });

        assertEqual(
            'plugins/visits/pages/visits/page.json,plugins/visits/pages/visits/page.html',
            pluginTemplate.sourceFiles.join(),
        );
        assertEqual('app,visits', graph.pages.map(({ owner }) => owner).join());
    });

    it('returns exactly what compileContent() resolves for the same roots and names', async () => {
        const files = makeFiles();
        const { compilation } = await compileProject(files);

        const direct = await compileContent({
            source: createMemoryContentSource(files),
            pluginContentRoots: [ {
                plugin: 'visits',
                pagesDirectory: 'plugins/visits/pages',
                templatesDirectory: 'plugins/visits/templates',
            } ],
            templateHelpers: [ 'greeting', 'if', 'unescape', 'visitCount' ],
        });

        assertEqual(JSON.stringify(direct.release), JSON.stringify(compilation.release));
        assertEqual(JSON.stringify(direct.report), JSON.stringify(compilation.report));
        assertEqual(JSON.stringify(direct.graph), JSON.stringify(compilation.graph));
        assertEqual(
            direct.objects.map(({ type, pathname, hash }) => `${ type } ${ pathname } ${ hash }`).join('\n'),
            compilation.objects.map(({ type, pathname, hash }) => `${ type } ${ pathname } ${ hash }`).join('\n'),
        );
    });

    it('reads the manifests before any content', async () => {
        const { calls } = await compileProject(makeFiles());
        const firstContentCall = calls.findIndex((call) => !call.startsWith('manifest '));

        assertEqual(
            'manifest kixx/plugin.json,manifest plugins/visits/plugin.json,manifest app/app.json',
            calls.slice(0, firstContentCall).join(),
        );
        assert(calls.slice(firstContentCall).every((call) => !call.startsWith('manifest ')));
    });

    // Each owner's declaration is what lets its helper compile.
    for (const [ owner, file, manifest, helper, template ] of [
        [ 'core', 'kixx/plugin.json', CORE_MANIFEST, 'unescape', 'templates/base/default.html' ],
        [ 'a plugin', 'plugins/visits/plugin.json', VISITS_MANIFEST, 'visitCount', 'plugins/visits/pages/visits/page.html' ],
        [ 'the app', 'app/app.json', APP_MANIFEST, 'greeting', 'pages/page.html' ],
    ]) {
        it(`refuses the Release when ${ owner } does not declare a helper its templates use`, async () => {
            const templateHelpers = manifest.templateHelpers.filter((name) => name !== helper);
            const files = makeFiles({ [file]: JSON.stringify(Object.assign({}, manifest, { templateHelpers })) });

            const { compilation } = await compileProject(files);
            const { release, report } = compilation;

            assertEqual(null, release);
            assertEqual(1, report.problems.length);
            assertEqual('unregistered-helper', report.problems[0].code);
            assertEqual(helper, report.problems[0].helper);
            assertEqual(template, report.problems[0].filepath);
        });
    }

    it('compiles a project with no plugin and no app manifest', async () => {
        const { compilation } = await compileProject({
            'kixx/plugin.json': JSON.stringify(CORE_MANIFEST),
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
            'pages/page.html': '<h1>{{#if page.title}}{{ page.title }}{{/if}}</h1>',
        });

        assertEqual('[]', JSON.stringify(compilation.report.problems));
        assertEqual('/', Object.keys(compilation.release.manifest.pages).join());
    });

    it('reads core\'s manifest from the core directory it is given', async () => {
        const files = makeFiles();

        files['vendor/kixx/plugin.json'] = files['kixx/plugin.json'];
        delete files['kixx/plugin.json'];

        const { compilation, calls } = await compileProject(files, 'vendor/kixx');

        assertEqual('manifest vendor/kixx/plugin.json', calls[0]);
        assertEqual('[]', JSON.stringify(compilation.report.problems));
    });

    it('rejects on an invalid manifest before reading any content', async () => {
        const files = makeFiles({
            'plugins/visits/plugin.json': JSON.stringify(Object.assign({}, VISITS_MANIFEST, { templateHelpers: [ 'visit-count' ] })),
        });
        const { fileSystem, source, calls } = makeProject(files);

        const caught = await catchRejection(compileProjectContent({ fileSystem, source }));

        assertEqual('ValidationError', caught.name);
        assert(caught.message.includes('plugins/visits/plugin.json'), caught.message);
        assertEqual('', contentCalls(calls).join());
    });

    it('rejects on a manifest that is not JSON, and on a missing core manifest', async () => {
        const broken = makeProject(makeFiles({ 'app/app.json': '{' }));
        const notJson = await catchRejection(compileProjectContent(broken));

        assertEqual('OperationalError', notJson.name);
        assert(notJson.message.startsWith('Invalid JSON in app/app.json'), notJson.message);
        assertEqual('', contentCalls(broken.calls).join());

        const coreless = makeProject({ 'pages/page.json': '{}' });
        const noCore = await catchRejection(compileProjectContent(coreless));

        assertEqual('OperationalError', noCore.name);
        assertEqual('Missing core manifest: kixx/plugin.json', noCore.message);
        assertEqual('', contentCalls(coreless.calls).join());
    });

    // Core lives outside the project in the monorepo. Content it declared
    // there can't be read through a source rooted at the project, so the
    // compile is refused: not read, and not skipped.
    it('refuses content declared by a core that lives outside the project', async () => {
        const core = Object.assign({}, CORE_MANIFEST, { content: { pagesDirectory: './pages' } });
        const files = makeFiles();

        delete files['kixx/plugin.json'];

        const { fileSystem, source, calls } = makeProject(files);

        // The manifest file system can reach outside the root. The content
        // source can't.
        const readTextFile = fileSystem.readTextFile;
        fileSystem.readTextFile = async (path) => {
            return path === '../kixx/plugin.json' ? JSON.stringify(core) : await readTextFile(path);
        };

        const caught = await catchRejection(compileProjectContent({ fileSystem, source, coreDirectory: '../kixx' }));

        assertEqual('ValidationError', caught.name);
        assertEqual('Content root "pagesDirectory" of "kixx" is outside the project: ../kixx/pages', caught.message);
        assertEqual('', contentCalls(calls).join());
    });

    it('compiles core\'s content when core is inside the project', async () => {
        const core = Object.assign({}, CORE_MANIFEST, { content: { pagesDirectory: './pages' } });
        const files = makeFiles({
            'kixx/plugin.json': JSON.stringify(core),
            'kixx/pages/status/page.json': JSON.stringify({ page: { title: 'Status' } }),
        });

        const { compilation } = await compileProject(files);

        assertEqual('[]', JSON.stringify(compilation.report.problems));
        assertEqual('/,/status,/visits', Object.keys(compilation.release.manifest.pages).join());
        assertEqual('kixx', compilation.graph.pages.find(({ pathname }) => pathname === '/status').owner);
    });

    it('rejects when a port is missing', async () => {
        const { fileSystem, source } = makeProject(makeFiles());

        const noFileSystem = await catchRejection(compileProjectContent({ source }));
        assertEqual('AssertionError', noFileSystem.name);

        const noSource = await catchRejection(compileProjectContent({ fileSystem }));
        assertEqual('AssertionError', noSource.name);
        assert(noSource.message.includes('options.source must be a content source'), noSource.message);
    });
});

describe('tooling: the entry a tool loads', ({ it }) => {
    it('exports the project compile, the content roots, and the compiler\'s two functions', () => {
        assertEqual('function', typeof tooling.compileProjectContent);
        assertEqual('function', typeof tooling.listPluginContentRoots);
        assertEqual(contentCompiler.compileContent, compileContent);
        assertEqual(contentCompiler.serializeContentObject, serializeContentObject);
    });

    // A tool reads a real project, so the in-memory source is not part of
    // the entry. Neither are the two functions a server uses to serve a
    // compilation: a tool compiles and publishes, and serves nothing.
    it('exports nothing else from the compiler', () => {
        assertEqual(
            'createCompiledContent,createMemoryContentSource,listContentDirectories',
            Object.keys(contentCompiler).filter((name) => !Object.hasOwn(tooling, name)).join(),
        );
    });
});
