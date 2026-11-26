import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
} from 'kixx-assert';

import {
    MAX_MANIFEST_ENTRIES,
    MAX_OBJECT_BYTES,
} from '../../../kixx/content-addressable-store/content-limits.js';
import { validateReleaseManifest } from '../../../kixx/content-addressable-store/release-manifest.js';
import {
    checkContentLimits,
    compileContent,
    validateRelease,
} from '../../../kixx/content-compiler/compile-content.js';
import { createMemoryContentSource } from '../../../kixx/content-compiler/memory-content-source.js';


const decoder = new TextDecoder();

const HASH = '2bkn6qpwuhu2yuf5v46kuerjni';

const ADMIN_ROOT = {
    plugin: 'admin',
    pagesDirectory: 'plugins/admin/pages',
    templatesDirectory: 'plugins/admin/templates',
    staticAssetsDirectory: 'plugins/admin/static-assets',
};

const VISITS_ROOT = {
    plugin: 'visits',
    pagesDirectory: 'plugins/visits/pages',
    templatesDirectory: 'plugins/visits/templates',
    staticAssetsDirectory: 'plugins/visits/static-assets',
};

function makeProjectFiles() {
    return {
        'pages/page.json': JSON.stringify({ template: 'page.html' }),
        'pages/page.html': '<main>Home</main>',
        'templates/partials/nav.html': '<nav></nav>',
        'templates/base/default.html': '<html>{{ content }}</html>',
        'static-assets/site.css': 'a { color: red; }',
        'public/robots.txt': 'User-agent: *',
    };
}

function makeAdminFiles() {
    return {
        'plugins/admin/pages/admin/page.json': JSON.stringify({
            template: 'page.html',
            partials: [ { id: 'nav.html', filename: 'nav.html' } ],
        }),
        'plugins/admin/pages/admin/page.html': '<main>{{> nav.html }}</main>',
        'plugins/admin/pages/admin/nav.html': '<nav>Admin</nav>',
        'plugins/admin/templates/partials/admin/notice.html': '<p>Notice</p>',
        'plugins/admin/templates/base/admin.html': '<html class="admin">{{ content }}</html>',
        'plugins/admin/static-assets/admin/admin.css': '@import "./lib/reset.css";\nb { color: blue; }',
        'plugins/admin/static-assets/admin/lib/reset.css': 'i { margin: 0; }',
        'plugins/admin/static-assets/admin/admin.js': '// Says hello\nconsole.log("hello");\n',
    };
}

function compile(files, pluginContentRoots, options) {
    return compileContent({
        source: createMemoryContentSource(files, options),
        pluginContentRoots,
        templateHelpers: [],
    });
}

function findObject(objects, type, pathname) {
    return objects.find((object) => object.type === type && object.pathname === pathname);
}

function findProblems(result, code) {
    return result.report.problems.filter((problem) => problem.code === code);
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    return null;
}

function makeObject(overrides) {
    return {
        type: 'StaticAsset',
        pathname: 'a.txt',
        payload: 'a',
        hash: HASH,
        size: 1,
        sourceFiles: [ 'public/a.txt' ],
        ...overrides,
    };
}

describe('content-compiler/plugin-content', ({ describe: group }) => {

    group('a plugin with content of every kind (CONT-1)', ({ before, it }) => {
        let result;

        before(async () => {
            result = await compile({ ...makeProjectFiles(), ...makeAdminFiles() }, [ ADMIN_ROOT ]);
        });

        it('compiles with no problem into one Release', () => {
            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
            assertEqual(result.objects.length, validateReleaseManifest(result.release.manifest).length);
        });

        it('adds the plugin page beside the project pages', () => {
            const metadata = findObject(result.objects, 'PageMetadata', '/admin');
            const template = findObject(result.objects, 'PageTemplate', '/admin/page.html');

            assertEqual('plugins/admin/pages/admin/page.json', metadata.sourceFiles.join());
            assertEqual(
                'plugins/admin/pages/admin/page.json,plugins/admin/pages/admin/page.html',
                template.sourceFiles.join(),
            );
            assertEqual('/,/admin', Object.keys(result.release.manifest.pages).join());
            assertEqual(template.hash, result.release.manifest.pages['/admin'].templates['page.html'].objectId);
        });

        it('lets a page partial share its id with a global partial', () => {
            const partials = findObject(result.objects, 'PagePartials', '/admin');

            assertEqual('nav.html', partials.payload.map(({ id }) => id).join());
        });

        it('merges global partials into one bundle, the project first', () => {
            const bundle = findObject(result.objects, 'GlobalTemplatePartials', '/');

            assertEqual('nav.html,admin/notice.html', bundle.payload.map(({ id }) => id).join());
            assertEqual(
                'templates/partials/nav.html,plugins/admin/templates/partials/admin/notice.html',
                bundle.sourceFiles.join(),
            );
            assertEqual(bundle.hash, result.release.manifest.globalTemplatePartials.objectId);
        });

        it('merges base templates into one bundle, the project first', () => {
            const bundle = findObject(result.objects, 'BaseTemplates', '/');

            assertEqual('default.html,admin.html', bundle.payload.map(({ id }) => id).join());
            assertEqual(
                'templates/base/default.html,plugins/admin/templates/base/admin.html',
                bundle.sourceFiles.join(),
            );
        });

        it('bundles a plugin stylesheet\'s imports from its own directory', () => {
            const stylesheet = findObject(result.objects, 'StaticAsset', 'admin/admin.css');
            const source = decoder.decode(stylesheet.payload);

            assert(source.includes('i { margin: 0; }'), source);
            assert(source.includes('b { color: blue; }'), source);
            assertFalsy(source.includes('@import'), source);
            assertEqual(
                'plugins/admin/static-assets/admin/admin.css,plugins/admin/static-assets/admin/lib/reset.css',
                stylesheet.sourceFiles.slice().sort().join(),
            );
            assertEqual(stylesheet.hash, result.release.manifest.staticAssets['/admin/admin.css'].objectId);
        });

        it('strips the comments from a plugin script', () => {
            const script = findObject(result.objects, 'StaticAsset', 'admin/admin.js');
            const source = decoder.decode(script.payload);

            assertFalsy(source.includes('Says hello'), source);
            assert(source.includes('console.log("hello");'), source);
        });
    });

    group('plugin content directories', ({ it }) => {
        it('builds a bundle from plugin templates alone', async () => {
            const result = await compile({
                'plugins/admin/templates/partials/admin/notice.html': '<p>Notice</p>',
            }, [ ADMIN_ROOT ]);

            assertEqual('GlobalTemplatePartials /', result.objects.map(({ type, pathname }) => `${ type } ${ pathname }`).join());
            assert(result.release.manifest.globalTemplatePartials);
            assertFalsy(result.release.manifest.baseTemplates);
        });

        it('treats a directory that does not exist as empty', async () => {
            const result = await compile(makeProjectFiles(), [ ADMIN_ROOT, VISITS_ROOT ]);
            const alone = await compile(makeProjectFiles(), []);

            assertEqual('[]', JSON.stringify(result.report.problems));
            assertEqual(JSON.stringify(alone.release), JSON.stringify(result.release));
        });

        it('accepts more than one root for a plugin', async () => {
            const result = await compile({
                'plugins/admin/pages/admin/page.json': '{}',
                'plugins/admin/extra/pages/admin/users/page.json': '{}',
            }, [
                { plugin: 'admin', pagesDirectory: 'plugins/admin/pages' },
                { plugin: 'admin', pagesDirectory: 'plugins/admin/extra/pages' },
            ]);

            assertEqual('/admin,/admin/users', Object.keys(result.release.manifest.pages).join());
        });

        it('lets a project page sit beside and beneath a plugin page', async () => {
            const result = await compile({
                'pages/admin/reports/page.json': '{}',
                'pages/about/page.json': '{}',
                'plugins/admin/pages/admin/page.json': '{}',
            }, [ ADMIN_ROOT ]);

            assertEqual('[]', JSON.stringify(result.report.problems));
            assertEqual('/about,/admin,/admin/reports', Object.keys(result.release.manifest.pages).sort().join());
        });

        it('reports plugin problems and unmatched files with paths from the project root', async () => {
            const result = await compile({
                'plugins/admin/pages/admin/page.json': '{ nope',
                'plugins/admin/pages/admin/notes.txt': 'notes',
                'plugins/admin/templates/README.md': '# Templates',
            }, [ ADMIN_ROOT ], { symlinks: [ 'plugins/admin/static-assets/link.css' ] });

            assertEqual(
                'malformed-json plugins/admin/pages/admin/page.json,symlink-source-file plugins/admin/static-assets/link.css',
                result.report.problems.map(({ code, filepath }) => `${ code } ${ filepath }`).join(),
            );
            assertEqual(
                'plugins/admin/pages/admin/notes.txt,plugins/admin/templates/README.md',
                result.report.unmatchedFiles.join(),
            );
            assertEqual(null, result.release);
        });

        it('does not read a plugin directory the roots do not name', async () => {
            const result = await compile({
                'plugins/admin/pages/admin/page.json': '{}',
                'plugins/admin/public/robots.txt': 'User-agent: *',
            }, [ { plugin: 'admin', pagesDirectory: 'plugins/admin/pages' } ]);

            assertEqual('PageIncludes,PageMetadata,PagePartials', result.objects.map(({ type }) => type).join());
            assertEqual('', result.report.unmatchedFiles.join());
        });
    });

    group('a content root that is not inside the project', ({ it }) => {
        const outside = [
            [ '../../../kixx/pages', 'Content root "pagesDirectory" of "kixx" is outside the project: ../../../kixx/pages' ],
            [ 'plugins/../../pages', 'Content root "pagesDirectory" of "kixx" is outside the project: plugins/../../pages' ],
            [ '/srv/kixx/pages', 'Content root "pagesDirectory" of "kixx" is outside the project: /srv/kixx/pages' ],
            [ './kixx/pages', 'Content root "pagesDirectory" of "kixx" is not a plain path from the project root: ./kixx/pages' ],
            [ 'kixx//pages', 'Content root "pagesDirectory" of "kixx" is not a plain path from the project root: kixx//pages' ],
            [ 'kixx/pages/', 'Content root "pagesDirectory" of "kixx" is not a plain path from the project root: kixx/pages/' ],
            [ '', 'Content root "pagesDirectory" of "kixx" is not a plain path from the project root: ' ],
        ];

        it('rejects with a ValidationError that names the owner, the key, and the path', async () => {
            for (const [ pagesDirectory, message ] of outside) {
                const caught = await catchRejection(compile(makeProjectFiles(), [ { plugin: 'kixx', pagesDirectory } ]));

                assertEqual('ValidationError', caught.name);
                assertEqual(message, caught.message);
                assertEqual(message, caught.errors[0].message);
            }
        });

        it('lists every bad root', async () => {
            const caught = await catchRejection(compile(makeProjectFiles(), [
                ADMIN_ROOT,
                { plugin: 'kixx', pagesDirectory: '../kixx/pages', templatesDirectory: '/kixx/templates' },
            ]));

            assertEqual('/1/pagesDirectory,/1/templatesDirectory', caught.errors.map(({ source }) => source).join());
        });

        it('rejects before anything is listed', async () => {
            const calls = [];
            const source = {
                listFiles(directory) {
                    calls.push(directory);
                    return Promise.resolve({ kind: 'missing', entries: [] });
                },
                readFile(filepath) {
                    calls.push(filepath);
                    return Promise.resolve(null);
                },
            };

            const caught = await catchRejection(compileContent({
                source,
                pluginContentRoots: [ ADMIN_ROOT, { plugin: 'kixx', staticAssetsDirectory: '../kixx/static-assets' } ],
                templateHelpers: [],
            }));

            assertEqual('ValidationError', caught.name);
            assertEqual(0, calls.length);
        });
    });

    group('collisions between the project and a plugin', ({ it }) => {
        it('reports a page-collision and keeps the project page', async () => {
            const result = await compile({
                'pages/admin/page.json': JSON.stringify({ page: { title: 'Mine' } }),
                'plugins/admin/pages/admin/page.json': JSON.stringify({ template: 'page.html' }),
                'plugins/admin/pages/admin/page.html': '<main></main>',
            }, [ ADMIN_ROOT ]);

            assertEqual(JSON.stringify([ {
                code: 'page-collision',
                filepath: 'plugins/admin/pages/admin/page.json',
                message: 'Page "/admin" is supplied by the app (pages/admin/page.json) and by plugin "admin" (plugins/admin/pages/admin/page.json)',
                conflictingFile: 'pages/admin/page.json',
                owner: 'admin',
                conflictingOwner: 'app',
                pathname: '/admin',
            } ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
            assertEqual('Mine', findObject(result.objects, 'PageMetadata', '/admin').payload.page.title);
            assertEqual(1, result.objects.filter(({ type }) => type === 'PageMetadata').length);
            assertFalsy(findObject(result.objects, 'PageTemplate', '/admin/page.html'));
        });

        it('lets a malformed project page.json keep its pathname', async () => {
            const result = await compile({
                'pages/admin/page.json': '{ nope',
                'plugins/admin/pages/admin/page.json': '{}',
            }, [ ADMIN_ROOT ]);

            assertEqual('malformed-json,page-collision', result.report.problems.map(({ code }) => code).join());
            assertFalsy(findObject(result.objects, 'PageMetadata', '/admin'));
        });

        it('reports a partial-collision and keeps the project partial', async () => {
            const result = await compile({
                'templates/partials/shared/nav.html': '<nav>Mine</nav>',
                'plugins/admin/templates/partials/shared/nav.html': '<nav>Theirs</nav>',
                'plugins/admin/templates/partials/admin.html': '<p></p>',
            }, [ ADMIN_ROOT ]);

            assertEqual(JSON.stringify([ {
                code: 'partial-collision',
                filepath: 'plugins/admin/templates/partials/shared/nav.html',
                message: 'Global partial "shared/nav.html" is supplied by the app (templates/partials/shared/nav.html) and by plugin "admin" (plugins/admin/templates/partials/shared/nav.html)',
                conflictingFile: 'templates/partials/shared/nav.html',
                owner: 'admin',
                conflictingOwner: 'app',
                id: 'shared/nav.html',
            } ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);

            const bundle = findObject(result.objects, 'GlobalTemplatePartials', '/');
            assertEqual(
                JSON.stringify([ { id: 'shared/nav.html', source: '<nav>Mine</nav>' }, { id: 'admin.html', source: '<p></p>' } ]),
                JSON.stringify(bundle.payload),
            );
            assertEqual(
                'templates/partials/shared/nav.html,plugins/admin/templates/partials/admin.html',
                bundle.sourceFiles.join(),
            );
        });

        it('reports a base-template-collision and keeps the project template', async () => {
            const result = await compile({
                'templates/base/default.html': '<html>Mine</html>',
                'plugins/admin/templates/base/default.html': '<html>Theirs</html>',
            }, [ ADMIN_ROOT ]);

            assertEqual(JSON.stringify([ {
                code: 'base-template-collision',
                filepath: 'plugins/admin/templates/base/default.html',
                message: 'Base template "default.html" is supplied by the app (templates/base/default.html) and by plugin "admin" (plugins/admin/templates/base/default.html)',
                conflictingFile: 'templates/base/default.html',
                owner: 'admin',
                conflictingOwner: 'app',
                id: 'default.html',
            } ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
            assertEqual(
                JSON.stringify([ { id: 'default.html', source: '<html>Mine</html>' } ]),
                JSON.stringify(findObject(result.objects, 'BaseTemplates', '/').payload),
            );
        });

        it('reports a static-asset-collision with the project\'s static-assets and public files', async () => {
            const result = await compile({
                'static-assets/logo.svg': '<svg>mine</svg>',
                'public/robots.txt': 'mine',
                'plugins/admin/static-assets/logo.svg': '<svg>theirs</svg>',
                'plugins/admin/static-assets/robots.txt': 'theirs',
            }, [ ADMIN_ROOT ]);

            assertEqual(JSON.stringify([
                {
                    code: 'static-asset-collision',
                    filepath: 'plugins/admin/static-assets/logo.svg',
                    message: 'Static asset "logo.svg" is supplied by the app (static-assets/logo.svg) and by plugin "admin" (plugins/admin/static-assets/logo.svg)',
                    conflictingFile: 'static-assets/logo.svg',
                    owner: 'admin',
                    conflictingOwner: 'app',
                    pathname: 'logo.svg',
                },
                {
                    code: 'static-asset-collision',
                    filepath: 'plugins/admin/static-assets/robots.txt',
                    message: 'Static asset "robots.txt" is supplied by the app (public/robots.txt) and by plugin "admin" (plugins/admin/static-assets/robots.txt)',
                    conflictingFile: 'public/robots.txt',
                    owner: 'admin',
                    conflictingOwner: 'app',
                    pathname: 'robots.txt',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
            assertEqual('<svg>mine</svg>', decoder.decode(findObject(result.objects, 'StaticAsset', 'logo.svg').payload));
            assertEqual('mine', decoder.decode(findObject(result.objects, 'StaticAsset', 'robots.txt').payload));
            assertEqual(2, result.objects.length);
        });
    });

    group('collisions between two plugins', ({ it }) => {
        it('reports each kind, naming both plugins, and keeps the first plugin\'s content', async () => {
            const result = await compile({
                'plugins/admin/pages/tools/page.json': JSON.stringify({ page: { title: 'Admin' } }),
                'plugins/admin/templates/partials/tools.html': 'admin',
                'plugins/admin/templates/base/tools.html': 'admin',
                'plugins/admin/static-assets/tools.txt': 'admin',
                'plugins/visits/pages/tools/page.json': JSON.stringify({ page: { title: 'Visits' } }),
                'plugins/visits/templates/partials/tools.html': 'visits',
                'plugins/visits/templates/base/tools.html': 'visits',
                'plugins/visits/static-assets/tools.txt': 'visits',
            }, [ ADMIN_ROOT, VISITS_ROOT ]);

            assertEqual(JSON.stringify([
                {
                    code: 'page-collision',
                    filepath: 'plugins/visits/pages/tools/page.json',
                    message: 'Page "/tools" is supplied by plugin "admin" (plugins/admin/pages/tools/page.json) and by plugin "visits" (plugins/visits/pages/tools/page.json)',
                    conflictingFile: 'plugins/admin/pages/tools/page.json',
                    owner: 'visits',
                    conflictingOwner: 'admin',
                    pathname: '/tools',
                },
                {
                    code: 'partial-collision',
                    filepath: 'plugins/visits/templates/partials/tools.html',
                    message: 'Global partial "tools.html" is supplied by plugin "admin" (plugins/admin/templates/partials/tools.html) and by plugin "visits" (plugins/visits/templates/partials/tools.html)',
                    conflictingFile: 'plugins/admin/templates/partials/tools.html',
                    owner: 'visits',
                    conflictingOwner: 'admin',
                    id: 'tools.html',
                },
                {
                    code: 'base-template-collision',
                    filepath: 'plugins/visits/templates/base/tools.html',
                    message: 'Base template "tools.html" is supplied by plugin "admin" (plugins/admin/templates/base/tools.html) and by plugin "visits" (plugins/visits/templates/base/tools.html)',
                    conflictingFile: 'plugins/admin/templates/base/tools.html',
                    owner: 'visits',
                    conflictingOwner: 'admin',
                    id: 'tools.html',
                },
                {
                    code: 'static-asset-collision',
                    filepath: 'plugins/visits/static-assets/tools.txt',
                    message: 'Static asset "tools.txt" is supplied by plugin "admin" (plugins/admin/static-assets/tools.txt) and by plugin "visits" (plugins/visits/static-assets/tools.txt)',
                    conflictingFile: 'plugins/admin/static-assets/tools.txt',
                    owner: 'visits',
                    conflictingOwner: 'admin',
                    pathname: 'tools.txt',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
            assertEqual('Admin', findObject(result.objects, 'PageMetadata', '/tools').payload.page.title);
            assertEqual('admin', findObject(result.objects, 'GlobalTemplatePartials', '/').payload[0].source);
            assertEqual('admin', findObject(result.objects, 'BaseTemplates', '/').payload[0].source);
            assertEqual('admin', decoder.decode(findObject(result.objects, 'StaticAsset', 'tools.txt').payload));
        });

        it('reports a collision between two roots of one plugin the same way', async () => {
            const result = await compile({
                'plugins/admin/pages/admin/page.json': '{}',
                'plugins/admin/extra/pages/admin/page.json': '{}',
            }, [
                { plugin: 'admin', pagesDirectory: 'plugins/admin/pages' },
                { plugin: 'admin', pagesDirectory: 'plugins/admin/extra/pages' },
            ]);

            assertEqual(
                'Page "/admin" is supplied by plugin "admin" (plugins/admin/pages/admin/page.json) and by plugin "admin" (plugins/admin/extra/pages/admin/page.json)',
                result.report.problems.map(({ message }) => message).join(),
            );
        });
    });

    group('checkContentLimits() (PERF-1)', ({ it }) => {
        it('accepts an object at the size limit and a list at the entry limit', () => {
            const objects = new Array(MAX_MANIFEST_ENTRIES).fill(makeObject({ size: MAX_OBJECT_BYTES }));

            assertEqual(0, checkContentLimits(objects).length);
            assertEqual(0, checkContentLimits([]).length);
        });

        it('reports each object over the size limit on its first source file', () => {
            const problems = checkContentLimits([
                makeObject(),
                makeObject({
                    pathname: 'video.mp4',
                    size: MAX_OBJECT_BYTES + 1,
                    sourceFiles: [ 'public/video.mp4' ],
                }),
                makeObject({
                    type: 'PageIncludes',
                    pathname: '/about',
                    size: MAX_OBJECT_BYTES * 2,
                    sourceFiles: [ 'pages/about/page.json', 'pages/about/body.md' ],
                }),
            ]);

            assertEqual(JSON.stringify([
                {
                    code: 'object-too-large',
                    filepath: 'public/video.mp4',
                    message: 'StaticAsset "video.mp4" is 26214401 bytes, over the limit of 26214400',
                    type: 'StaticAsset',
                    pathname: 'video.mp4',
                    size: 26214401,
                    limit: 26214400,
                },
                {
                    code: 'object-too-large',
                    filepath: 'pages/about/page.json',
                    message: 'PageIncludes "/about" is 52428800 bytes, over the limit of 26214400',
                    type: 'PageIncludes',
                    pathname: '/about',
                    size: 52428800,
                    limit: 26214400,
                },
            ], null, 2), JSON.stringify(problems, null, 2));
        });

        it('reports once when there are more objects than a manifest may name', () => {
            const objects = new Array(MAX_MANIFEST_ENTRIES + 1).fill(makeObject());

            assertEqual(JSON.stringify([ {
                code: 'too-many-objects',
                filepath: '',
                message: 'The content compiles to 10001 objects, over the limit of 10000',
                count: 10001,
                limit: 10000,
            } ]), JSON.stringify(checkContentLimits(objects)));
        });
    });

    group('validateRelease()', ({ it }) => {
        it('returns the manifest and no problem for objects a store accepts', () => {
            const { manifest, problems } = validateRelease([
                makeObject(),
                makeObject({ type: 'PageMetadata', pathname: '/', payload: {}, sourceFiles: [ 'pages/page.json' ] }),
            ]);

            assertEqual(0, problems.length);
            assertEqual(HASH, manifest.staticAssets['/a.txt'].objectId);
            assertEqual(1, manifest.pages['/'].metadata.size);
        });

        it('reports what the manifest validator rejects', () => {
            const { problems } = validateRelease([
                makeObject({ hash: 'not-a-hash' }),
            ]);

            assertEqual(JSON.stringify([ {
                code: 'invalid-release',
                filepath: '',
                message: 'objectId must be a valid content address (/staticAssets/~1a.txt/objectId)',
                source: '/staticAssets/~1a.txt/objectId',
            } ]), JSON.stringify(problems));
        });

        it('reports what the structured content validator rejects, on the object\'s first source file', () => {
            const { problems } = validateRelease([
                makeObject({
                    type: 'GlobalTemplatePartials',
                    pathname: '/',
                    payload: [ { id: 'nav.html', source: '' } ],
                    sourceFiles: [ 'templates/partials/nav.html' ],
                }),
            ]);

            assertEqual(JSON.stringify([ {
                code: 'invalid-release',
                filepath: 'templates/partials/nav.html',
                message: 'partial template source must be a non-empty string (/globalTemplatePartials/0/source)',
                source: '/globalTemplatePartials/0/source',
            } ]), JSON.stringify(problems));
        });

        it('throws an error that is not a validation failure', () => {
            let caught = null;

            try {
                validateRelease([ makeObject({ type: 'Nope' }) ]);
            } catch (error) {
                caught = error;
            }

            assertEqual('AssertionError', caught.name);
        });
    });

    group('a tree only the validators refuse', ({ it }) => {
        it('reports invalid-release problems and builds no Release', async () => {
            // The template of /a is published as /a/b.html, where the page
            // /a/b.html stores its own files.
            const result = await compile({
                'pages/a/page.json': JSON.stringify({ template: 'layouts/b.html' }),
                'pages/a/layouts/b.html': '<main></main>',
                'pages/a/b.html/page.json': '{}',
            }, []);

            assertEqual(null, result.release);
            assert(result.report.problems.length > 0);
            assertEqual('invalid-release', Array.from(new Set(findProblems(result, 'invalid-release').map(({ code }) => code))).join());
            assertEqual(result.report.problems.length, findProblems(result, 'invalid-release').length);
            assert(result.objects.length > 0);
        });
    });
});
