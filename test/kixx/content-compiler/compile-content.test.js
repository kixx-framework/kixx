import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from 'kixx-assert';

import { canonicalize, hashBlob } from '../../../kixx/content-addressable-store/addressing.js';
import {
    validateReleaseManifest,
    validateStructuredContent,
} from '../../../kixx/content-addressable-store/release-manifest.js';
import {
    compileContent,
    createMemoryContentSource,
    serializeContentObject,
} from '../../../kixx/content-compiler/mod.js';


const STRUCTURED_KINDS = {
    GlobalTemplatePartials: 'globalTemplatePartials',
    BaseTemplates: 'baseTemplates',
    PageMetadata: 'pageMetadata',
    PagePartials: 'pagePartials',
    PageIncludes: 'pageIncludes',
};

function makeProjectFiles() {
    return {
        'pages/page.json': JSON.stringify({ template: 'page.html', page: { title: 'Home' } }),
        'pages/page.html': '<main>Home</main>',
        'pages/about/page.json': JSON.stringify({
            template: 'layouts/about.html',
            partials: [ { id: 'bio', filename: 'bio.html' } ],
            includes: { body: { filename: 'body.md' } },
        }),
        'pages/about/layouts/about.html': '<main>{{> bio }}</main>',
        'pages/about/bio.html': '<p>Bio</p>',
        'pages/about/body.md': '# About',
        'templates/partials/nav.html': '<nav></nav>',
        'templates/base/default.html': '<html>{{ content }}</html>',
        'static-assets/site.css': 'a { color: red; }',
        'public/robots.txt': 'User-agent: *',
    };
}

function compile(files, options) {
    return compileContent({
        source: createMemoryContentSource(files, options),
        templateHelpers: [],
    });
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    return null;
}

describe('content-compiler/compile-content', ({ describe: group }) => {

    group('compileContent() with a project that has no problems', ({ it }) => {
        it('returns objects sorted by type then pathname', async () => {
            const result = await compile(makeProjectFiles());

            assertEqual([
                'BaseTemplates /',
                'GlobalTemplatePartials /',
                'PageIncludes /',
                'PageIncludes /about',
                'PageMetadata /',
                'PageMetadata /about',
                'PagePartials /',
                'PagePartials /about',
                'PageTemplate /about/about.html',
                'PageTemplate /page.html',
                'StaticAsset robots.txt',
                'StaticAsset site.css',
            ].join('\n'), result.objects.map(({ type, pathname }) => `${ type } ${ pathname }`).join('\n'));
        });

        it('addresses each object by what a store receives for it', async () => {
            const result = await compile(makeProjectFiles());

            for (const object of result.objects) {
                const blob = serializeContentObject(object);
                const size = typeof blob === 'string'
                    ? new TextEncoder().encode(blob).byteLength
                    : blob.byteLength;

                assertEqual(await hashBlob(blob), object.hash, `${ object.type } ${ object.pathname } hash`);
                assertEqual(size, object.size, `${ object.type } ${ object.pathname } size`);
            }
        });

        it('records the source files of each object as paths from the project root', async () => {
            const result = await compile(makeProjectFiles());
            const sourceFiles = (type, pathname) => {
                return result.objects.find((object) => {
                    return object.type === type && object.pathname === pathname;
                }).sourceFiles.join(',');
            };

            assertEqual('pages/about/page.json', sourceFiles('PageMetadata', '/about'));
            assertEqual('pages/about/page.json,pages/about/layouts/about.html', sourceFiles('PageTemplate', '/about/about.html'));
            assertEqual('pages/about/page.json,pages/about/bio.html', sourceFiles('PagePartials', '/about'));
            assertEqual('pages/about/page.json,pages/about/body.md', sourceFiles('PageIncludes', '/about'));
            assertEqual('templates/partials/nav.html', sourceFiles('GlobalTemplatePartials', '/'));
            assertEqual('public/robots.txt', sourceFiles('StaticAsset', 'robots.txt'));
        });

        it('returns a release whose manifest core accepts', async () => {
            const result = await compile(makeProjectFiles());

            assertEqual(0, result.report.problems.length);
            assert(result.release, 'expected a release');

            const files = validateReleaseManifest(result.release.manifest);
            assertEqual(result.objects.length, files.length);
        });

        it('builds structured objects core accepts', async () => {
            const result = await compile(makeProjectFiles());
            let checked = 0;

            for (const object of result.objects) {
                const kind = STRUCTURED_KINDS[object.type];

                if (kind) {
                    validateStructuredContent(kind, JSON.parse(serializeContentObject(object)));
                    checked += 1;
                }
            }

            assertEqual(8, checked);
        });

        it('returns an empty per-page report and the dependency graph', async () => {
            const result = await compile(makeProjectFiles());

            assertEqual('[]', JSON.stringify(result.report.pages));
            assertEqual('/,/about', result.graph.pages.map(({ pathname }) => pathname).join());
            assertEqual('nav.html', result.graph.globalPartials.map(({ id }) => id).join());
            assertEqual('default.html', result.graph.baseTemplates.map(({ id }) => id).join());
        });

        it('compiles a project with no content at all', async () => {
            const result = await compile({});

            assertEqual(0, result.objects.length);
            assertEqual('{"pages":{},"staticAssets":{}}', canonicalize(result.release.manifest));
        });
    });

    group('compileContent() and unmatched files', ({ it }) => {
        it('lists them, sorted, and still returns a release', async () => {
            const result = await compile({
                ...makeProjectFiles(),
                'templates/README.md': 'notes',
                'pages/about/unused.html': 'unused',
                'pages/orphan.txt': 'orphan',
            });

            assertEqual(
                'pages/about/unused.html,pages/orphan.txt,templates/README.md',
                result.report.unmatchedFiles.join(','),
            );
            assertEqual(0, result.report.problems.length);
            assert(result.release, 'unmatched files must not refuse a release');
        });
    });

    group('compileContent() with a problem', ({ it }) => {
        it('returns a null release, and still returns the objects that could be built', async () => {
            const result = await compile({
                ...makeProjectFiles(),
                'static-assets/empty.txt': '',
            });

            assertEqual(null, result.release);
            assertEqual('empty-static-asset', result.report.problems.map(({ code }) => code).join(','));
            assertEqual(12, result.objects.length);
        });

        it('reports a page.json that starts with a byte order mark as malformed JSON', async () => {
            const result = await compile({
                'pages/page.json': '﻿{"template":""}',
            });

            assertEqual(1, result.report.problems.length);
            assertEqual('malformed-json', result.report.problems[0].code);
            assertEqual('pages/page.json', result.report.problems[0].filepath);
            assertMatches(/^page\.json contains malformed JSON: /, result.report.problems[0].message);
            assertEqual(null, result.release);
        });

        it('keeps a byte order mark in a template and drops it from a stylesheet', async () => {
            const result = await compile({
                'pages/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/page.html': '﻿<main></main>',
                'templates/base/default.html': '﻿<html></html>',
                'static-assets/site.css': '﻿a { color: red; }',
                'static-assets/app.js': '﻿const a = 1;',
                'public/raw.css': '﻿a {}',
            });
            const find = (type, pathname) => {
                return result.objects.find((object) => object.type === type && object.pathname === pathname);
            };
            const decode = (buffer) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(buffer);

            assertEqual('﻿<main></main>', find('PageTemplate', '/page.html').payload);
            assertEqual('﻿<html></html>', find('BaseTemplates', '/').payload[0].source);
            assertEqual('a { color: red; }', decode(find('StaticAsset', 'site.css').payload));
            assertEqual('const a = 1;', decode(find('StaticAsset', 'app.js').payload));
            assertEqual('﻿a {}', decode(find('StaticAsset', 'raw.css').payload));
        });

        it('reports page.json problems with their fields and messages', async () => {
            const result = await compile({
                'pages/page.json': '[]',
                'pages/shape/page.json': JSON.stringify({ template: 42 }),
                'pages/refs/page.json': JSON.stringify({
                    template: '../shape/page.html',
                    partials: [
                        { id: 'gone', filename: 'gone.html' },
                        { id: 'dir', filename: 'folder' },
                    ],
                }),
                'pages/refs/folder/inner.html': 'inner',
                'pages/reserved/page.json': JSON.stringify({ template: 'page.json' }),
                'pages/empty/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/empty/page.html': '',
                'pages/Upper/page.json': '{}',
            });

            assertEqual(JSON.stringify([
                {
                    code: 'invalid-pathname',
                    filepath: 'pages/Upper/page.json',
                    message: 'Filepath cannot be represented by a canonical content pathname',
                },
                {
                    code: 'empty-page-template',
                    filepath: 'pages/empty/page.json',
                    message: 'Page template "page.html" is empty',
                    referencedFile: 'pages/empty/page.html',
                    page: '/empty',
                },
                {
                    code: 'invalid-manifest',
                    filepath: 'pages/page.json',
                    message: 'page.json must contain a JSON object',
                    page: '/',
                },
                {
                    code: 'invalid-pathname',
                    filepath: 'pages/refs/page.json',
                    message: 'page template references invalid pathname "../shape/page.html"',
                    referencedFile: '../shape/page.html',
                    page: '/refs',
                },
                {
                    code: 'missing-referenced-file',
                    filepath: 'pages/refs/page.json',
                    message: 'page partial "dir" reference "pages/refs/folder" is not a file',
                    referencedFile: 'pages/refs/folder',
                    page: '/refs',
                },
                {
                    code: 'missing-referenced-file',
                    filepath: 'pages/refs/page.json',
                    message: 'page partial "gone" references missing file "pages/refs/gone.html"',
                    referencedFile: 'pages/refs/gone.html',
                    page: '/refs',
                },
                {
                    code: 'reserved-template-filename',
                    filepath: 'pages/reserved/page.json',
                    message: 'Page template "page.json" uses reserved filename "page.json"',
                    referencedFile: 'pages/reserved/page.json',
                    page: '/reserved',
                },
                {
                    code: 'invalid-manifest',
                    filepath: 'pages/shape/page.json',
                    message: 'template must be a string',
                    page: '/shape',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));

            // A file an invalid reference resolves to is not also reported
            // as unmatched.
            assertEqual('pages/refs/folder/inner.html', result.report.unmatchedFiles.join(','));
        });

        it('reports static asset problems with their fields and messages', async () => {
            const result = await compile({
                'static-assets/bad.js': 'const = 1;',
                'static-assets/empty.txt': '',
                'static-assets/shared.txt': 'static',
                'public/shared.txt': 'public',
            });

            assertEqual(JSON.stringify([
                {
                    code: 'invalid-javascript',
                    filepath: 'static-assets/bad.js',
                    message: 'JavaScript cannot be parsed at line 1, column 6',
                    line: 1,
                    column: 6,
                },
                {
                    code: 'empty-static-asset',
                    filepath: 'static-assets/empty.txt',
                    message: 'Static asset is empty',
                },
                {
                    code: 'static-asset-collision',
                    filepath: 'public/shared.txt',
                    message: 'Static asset pathname "shared.txt" is also produced by "static-assets/shared.txt"',
                    conflictingFile: 'static-assets/shared.txt',
                    owner: 'app',
                    conflictingOwner: 'app',
                    pathname: 'shared.txt',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
        });

        it('reports symbolic links from the listing, with their fields and messages', async () => {
            const result = await compile({
                'pages/page.json': JSON.stringify({
                    template: 'linked.html',
                    partials: [ { id: 'deep', filename: 'linked-directory/deep.html' } ],
                }),
            }, {
                symlinks: [
                    'pages/linked.html',
                    'pages/linked-directory',
                    'static-assets',
                ],
            });

            assertEqual(JSON.stringify([
                {
                    code: 'symlink-source-file',
                    filepath: 'pages/linked-directory',
                    message: 'Source path "linked-directory" cannot be a symbolic link',
                },
                {
                    code: 'symlink-source-file',
                    filepath: 'pages/linked.html',
                    message: 'Source path "linked.html" cannot be a symbolic link',
                },
                {
                    code: 'symlink-referenced-file',
                    filepath: 'pages/page.json',
                    message: 'page template reference "pages/linked.html" cannot use symbolic link "pages/linked.html"',
                    referencedFile: 'pages/linked.html',
                    symlink: 'pages/linked.html',
                    page: '/',
                },
                {
                    code: 'symlink-referenced-file',
                    filepath: 'pages/page.json',
                    message: 'page partial "deep" reference "pages/linked-directory/deep.html" cannot use symbolic link "pages/linked-directory"',
                    referencedFile: 'pages/linked-directory/deep.html',
                    symlink: 'pages/linked-directory',
                    page: '/',
                },
                {
                    code: 'symlink-source-root',
                    filepath: 'static-assets',
                    message: 'Source root "static-assets" cannot be a symbolic link',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });
    });

    group('compileContent() when the source fails', ({ it }) => {
        it('rejects with the failure of listFiles()', async () => {
            const failure = new Error('listing failed');
            const source = {
                async listFiles() {
                    throw failure;
                },
                async readFile() {
                    return null;
                },
            };

            const caught = await catchRejection(compileContent({ source, templateHelpers: [] }));

            assertEqual(failure, caught);
        });

        it('rejects with the failure of readFile()', async () => {
            const failure = new Error('read failed');
            const memorySource = createMemoryContentSource(makeProjectFiles());
            const source = {
                listFiles: memorySource.listFiles,
                async readFile() {
                    throw failure;
                },
            };

            const caught = await catchRejection(compileContent({ source, templateHelpers: [] }));

            assertEqual(failure, caught);
        });

        it('rejects when a listed file cannot be read', async () => {
            const memorySource = createMemoryContentSource(makeProjectFiles());
            const source = {
                listFiles: memorySource.listFiles,
                async readFile() {
                    return null;
                },
            };

            const caught = await catchRejection(compileContent({ source, templateHelpers: [] }));

            assertEqual('OperationalError', caught.name);
            assertMatches('pages/about/page.json', caught.message);
        });
    });

    group('compileContent() options', ({ it }) => {
        const source = createMemoryContentSource({});

        it('requires a content source', async () => {
            for (const value of [ undefined, null, {}, { listFiles() {} } ]) {
                const caught = await catchRejection(compileContent({ source: value, templateHelpers: [] }));
                assertEqual('AssertionError', caught.name);
            }

            assertEqual('AssertionError', (await catchRejection(compileContent())).name);
        });

        it('requires templateHelpers to be an array of strings', async () => {
            for (const value of [ undefined, 'if', [ 'if', 1 ] ]) {
                const caught = await catchRejection(compileContent({ source, templateHelpers: value }));
                assertEqual('AssertionError', caught.name);
            }
        });

        it('requires pluginContentRoots to be an array of roots', async () => {
            const invalid = [
                'plugins',
                {},
                [ null ],
                [ { pagesDirectory: 'plugins/visits/pages' } ],
                [ { plugin: '', pagesDirectory: 'plugins/visits/pages' } ],
                [ { plugin: 'visits' } ],
                [ { plugin: 'visits', pagesDirectory: 1 } ],
            ];

            for (const value of invalid) {
                const caught = await catchRejection(compileContent({
                    source,
                    templateHelpers: [],
                    pluginContentRoots: value,
                }));
                assertEqual('AssertionError', caught.name);
            }

            const result = await compileContent({ source, templateHelpers: [], pluginContentRoots: [] });
            assert(result.release);
        });
    });

    group('serializeContentObject()', ({ it }) => {
        it('returns text and bytes as they are', () => {
            const buffer = Uint8Array.from([ 1, 2, 3 ]).buffer;

            assertEqual('<main></main>', serializeContentObject({ payload: '<main></main>' }));
            assertEqual(buffer, serializeContentObject({ payload: buffer }));
        });

        it('returns the canonical JSON of a structure', () => {
            assertEqual('{"a":1,"b":2}', serializeContentObject({ payload: { b: 2, a: 1 } }));
            assertEqual('[{"id":"a","source":"A"}]', serializeContentObject({ payload: [ { source: 'A', id: 'a' } ] }));
        });
    });
});
