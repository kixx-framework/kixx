import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ContentAddressableStore from '../../../kixx/content-addressable-store/content-addressable-store.js';
import {
    compileContent,
    createCompiledContent,
    createMemoryContentSource,
    listContentDirectories,
    serializeContentObject,
} from '../../../kixx/content-compiler/mod.js';


const ADMIN_ROOT = {
    plugin: 'admin',
    pagesDirectory: 'plugins/admin/pages',
    templatesDirectory: 'plugins/admin/templates',
    staticAssetsDirectory: 'plugins/admin/static-assets',
};

const CONTEXT = { name: 'test-request-context' };

function makeProjectFiles() {
    return {
        'pages/page.json': JSON.stringify({ template: 'page.html', page: { title: 'Home' } }),
        'pages/page.html': '<main>{{> nav.html }}</main>',
        'pages/about/page.json': JSON.stringify({
            template: 'page.html',
            partials: [ { id: 'bio', filename: 'bio.html' } ],
        }),
        'pages/about/page.html': '<main>{{> bio }}</main>',
        'pages/about/bio.html': '<p>Bio</p>',
        'templates/partials/nav.html': '<nav></nav>',
        'templates/partials/footer.html': '<footer></footer>',
        'templates/base/default.html': '<html>{{{ body }}}{{> footer.html }}</html>',
        'templates/base/plain.html': '<html>{{{ body }}}</html>',
        'static-assets/site.css': '@import "./lib/reset.css";\na { color: red; }',
        'static-assets/lib/reset.css': 'b { margin: 0; }',
        'static-assets/logo.bin': new Uint8Array([ 0, 1, 2, 255 ]),
        'public/robots.txt': 'User-agent: *',
        'plugins/admin/pages/admin/page.json': JSON.stringify({ template: 'page.html' }),
        'plugins/admin/pages/admin/page.html': '<main>Admin</main>',
    };
}

function compile(files) {
    return compileContent({
        source: createMemoryContentSource(files),
        pluginContentRoots: [ ADMIN_ROOT ],
        templateHelpers: [],
    });
}

function findObject(compilation, type, pathname) {
    const object = compilation.objects.find((item) => item.type === type && item.pathname === pathname);
    assert(object, `expected a ${ type } object at "${ pathname }"`);
    return object;
}

// A real store over a content store port that is never reached, so every
// read below is known to come from the compiled content.
function makeStore() {
    const child = { debug() {}, info() {}, warn() {}, error() {}, createChild: () => child };
    const store = new ContentAddressableStore();
    store.initialize({ logger: { createChild: () => child }, contentStore: {} });
    return store;
}

async function openSnapshot(compilation) {
    const store = makeStore();
    const content = await createCompiledContent(compilation);
    store.supplyContent(CONTEXT, content);
    return { content, snapshot: await store.openSnapshot(CONTEXT) };
}

// assertEqual() compares Arrays by identity, so lists are compared as JSON.
function assertList(expected, actual) {
    assertEqual(JSON.stringify(expected), JSON.stringify(actual));
}

async function readStream(stream) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function catchRejection(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}

describe('content-compiler/compiled-content', ({ describe: group }) => {

    group('createCompiledContent() served through a snapshot', ({ it }) => {
        it('reads a page under the compiler\'s hashes', async () => {
            const compilation = await compile(makeProjectFiles());
            const { snapshot } = await openSnapshot(compilation);

            const page = await snapshot.batchGetPageAssets(CONTEXT, '/about');

            assertEqual(findObject(compilation, 'PageTemplate', '/about/page.html').hash, page.template.hash);
            assertEqual('<main>{{> bio }}</main>', page.template.text);
            assertEqual(findObject(compilation, 'PagePartials', '/about').hash, page.partials.hash);
            assertEqual('bio', page.partials.json[0].id);
            assertEqual(findObject(compilation, 'PageIncludes', '/about').hash, page.includes.hash);

            // The page's own metadata, then its ancestor's.
            const metadataHashes = page.pageDataFiles.map((file) => file.hash);
            assert(metadataHashes.includes(findObject(compilation, 'PageMetadata', '/about').hash));
            assert(metadataHashes.includes(findObject(compilation, 'PageMetadata', '/').hash));
        });

        it('reads a plugin\'s page', async () => {
            const compilation = await compile(makeProjectFiles());
            const { snapshot } = await openSnapshot(compilation);

            const page = await snapshot.batchGetPageAssets(CONTEXT, '/admin');

            assertEqual('<main>Admin</main>', page.template.text);
            assertEqual(findObject(compilation, 'PageTemplate', '/admin/page.html').hash, page.template.hash);
        });

        it('answers null for a page the tree doesn\'t hold', async () => {
            const { snapshot } = await openSnapshot(await compile(makeProjectFiles()));

            assertEqual(null, await snapshot.batchGetPageAssets(CONTEXT, '/missing'));
        });

        it('reads the two template bundles', async () => {
            const compilation = await compile(makeProjectFiles());
            const { snapshot } = await openSnapshot(compilation);

            const partials = await snapshot.getGlobalTemplatePartials(CONTEXT);
            const baseTemplates = await snapshot.getBaseTemplates(CONTEXT);

            assertEqual(findObject(compilation, 'GlobalTemplatePartials', '/').hash, partials.hash);
            assertEqual(findObject(compilation, 'GlobalTemplatePartials', '/').hash, snapshot.statGlobalTemplatePartials().hash);
            assertList([ 'footer.html', 'nav.html' ], partials.json.map(({ id }) => id).sort());
            assertEqual(findObject(compilation, 'BaseTemplates', '/').hash, baseTemplates.hash);
            assertEqual(findObject(compilation, 'BaseTemplates', '/').hash, snapshot.statBaseTemplates().hash);
        });

        it('lists and reads static assets, a public file and a bundled stylesheet included', async () => {
            const compilation = await compile(makeProjectFiles());
            const { snapshot } = await openSnapshot(compilation);

            const stylesheet = findObject(compilation, 'StaticAsset', 'site.css');
            const robots = findObject(compilation, 'StaticAsset', 'robots.txt');
            const listed = new Map(snapshot.listStaticAssets().map((asset) => [ asset.pathname, asset.hash ]));

            assertEqual(4, listed.size);
            assertEqual(stylesheet.hash, snapshot.statStaticAsset('/site.css').hash);
            assertEqual(robots.hash, snapshot.statStaticAsset('/robots.txt').hash);
            assert(Array.from(listed.values()).includes(stylesheet.hash));
            assert(Array.from(listed.values()).includes(robots.hash));

            const bundled = await snapshot.getStaticAsset(CONTEXT, '/site.css');
            const text = new TextDecoder().decode(await readStream(bundled.stream));

            assertEqual(stylesheet.hash, bundled.hash);
            assertEqual(new TextDecoder().decode(serializeContentObject(stylesheet)), text);
            assert(text.includes('margin: 0'), 'the import is bundled in');

            const publicFile = await snapshot.getStaticAsset(CONTEXT, '/robots.txt');
            assertEqual('User-agent: *', new TextDecoder().decode(await readStream(publicFile.stream)));
        });

        it('serves a fingerprinted asset by hash', async () => {
            const compilation = await compile(makeProjectFiles());
            const store = makeStore();
            store.supplyContent(CONTEXT, await createCompiledContent(compilation));

            const logo = findObject(compilation, 'StaticAsset', 'logo.bin');
            const stream = await store.getStaticAssetByHash(CONTEXT, '/logo.bin', logo.hash);

            assertList([ 0, 1, 2, 255 ], Array.from(await readStream(stream)));
        });

        it('returns the compilation\'s report', async () => {
            const compilation = await compile(makeProjectFiles());
            const content = await createCompiledContent(compilation);

            assertEqual(compilation.report, content.report);
            assertEqual(compilation.report.problems, content.problems);
            assertEqual(0, content.problems.length);
        });
    });

    group('the object reader', ({ it }) => {
        async function makeReader() {
            const compilation = await compile(makeProjectFiles());
            const content = await createCompiledContent(compilation);

            return {
                reader: content.objects,
                text: findObject(compilation, 'PageTemplate', '/page.html'),
                binary: findObject(compilation, 'StaticAsset', 'logo.bin'),
                structure: findObject(compilation, 'PageMetadata', '/'),
            };
        }

        it('reads a text object as text, bytes, and a stream', async () => {
            const { reader, text } = await makeReader();
            const expected = '<main>{{> nav.html }}</main>';

            assertEqual(expected, await reader.getFile(CONTEXT, 'text', '/ignored', text.hash));

            const buffer = await reader.getFile(CONTEXT, 'arrayBuffer', '/ignored', text.hash);
            assert(buffer instanceof ArrayBuffer);
            assertEqual(expected, new TextDecoder().decode(buffer));

            const stream = await reader.getFile(CONTEXT, 'stream', '/ignored', text.hash);
            assertEqual(expected, new TextDecoder().decode(await readStream(stream)));
        });

        it('reads a binary object as text, bytes, and a stream', async () => {
            const { reader, binary } = await makeReader();

            assertEqual('string', typeof await reader.getFile(CONTEXT, 'text', '/ignored', binary.hash));

            const buffer = await reader.getFile(CONTEXT, 'arrayBuffer', '/ignored', binary.hash);
            assertList([ 0, 1, 2, 255 ], Array.from(new Uint8Array(buffer)));

            const stream = await reader.getFile(CONTEXT, 'stream', '/ignored', binary.hash);
            assertList([ 0, 1, 2, 255 ], Array.from(await readStream(stream)));
        });

        it('reads a structured object as its canonical JSON', async () => {
            const { reader, structure } = await makeReader();

            assertEqual(
                serializeContentObject(structure),
                await reader.getFile(CONTEXT, 'text', '/ignored', structure.hash),
            );
        });

        it('hands out a copy of the bytes each time', async () => {
            const { reader, binary } = await makeReader();

            const first = await reader.getFile(CONTEXT, 'arrayBuffer', '/ignored', binary.hash);
            new Uint8Array(first).fill(9);
            const second = await reader.getFile(CONTEXT, 'arrayBuffer', '/ignored', binary.hash);

            assertList([ 0, 1, 2, 255 ], Array.from(new Uint8Array(second)));
        });

        it('returns a fresh stream on every call', async () => {
            const { reader, binary } = await makeReader();

            const first = await reader.getFile(CONTEXT, 'stream', '/ignored', binary.hash);
            const second = await reader.getFile(CONTEXT, 'stream', '/ignored', binary.hash);

            assert(first !== second);
            assertList([ 0, 1, 2, 255 ], Array.from(await readStream(first)));
            assertList([ 0, 1, 2, 255 ], Array.from(await readStream(second)));
        });

        it('answers null for an unknown hash', async () => {
            const { reader } = await makeReader();

            assertEqual(null, await reader.getFile(CONTEXT, 'text', '/ignored', 'unknown'));
            assertEqual(null, await reader.getFile(CONTEXT, 'stream', '/ignored', 'unknown'));
        });

        it('reads several objects aligned with the files it was given', async () => {
            const { reader, text, structure } = await makeReader();

            const values = await reader.getFiles(CONTEXT, 'text', [
                { hash: structure.hash },
                { hash: 'unknown' },
                { hash: text.hash },
            ]);

            assertEqual(3, values.length);
            assertEqual(serializeContentObject(structure), values[0]);
            assertEqual(null, values[1]);
            assertEqual('<main>{{> nav.html }}</main>', values[2]);
        });

        it('refuses a type it can\'t read', async () => {
            const { reader, text } = await makeReader();

            const caught = await catchRejection(() => reader.getFile(CONTEXT, 'json', '/ignored', text.hash));

            assertEqual('AssertionError', caught.name);
        });
    });

    group('problem lookups', ({ it }) => {
        it('reports no problem for a tree without any', async () => {
            const content = await createCompiledContent(await compile(makeProjectFiles()));

            assertList([], content.getPageProblems('/'));
            assertList([], content.getBaseTemplateProblems('default.html'));
            assertList([], content.getBaseTemplateProblems('no-such-template.html'));
        });

        it('lists a broken page\'s problems and leaves the other pages readable', async () => {
            const files = makeProjectFiles();
            files['pages/about/page.html'] = '<main>{{#if}}</main>';

            const compilation = await compile(files);
            const { content, snapshot } = await openSnapshot(compilation);

            assertEqual(null, compilation.release);

            const problems = content.getPageProblems('/about');

            assertEqual(1, problems.length);
            assertEqual('template-syntax-error', problems[0].code);
            assertEqual('pages/about/page.html', problems[0].filepath);
            assert(compilation.report.problems.includes(problems[0]), 'the report\'s own problem object');

            assertList([], content.getPageProblems('/'));
            assertList([], content.getPageProblems('/admin'));

            const home = await snapshot.batchGetPageAssets(CONTEXT, '/');
            assertEqual('<main>{{> nav.html }}</main>', home.template.text);
        });

        it('blocks the pages made from a file with a problem the template check didn\'t find', async () => {
            // A content limit or a validator names only the file at fault.
            const compilation = await compile(makeProjectFiles());
            const tooLarge = { code: 'object-too-large', filepath: 'pages/about/bio.html', message: 'too large' };
            const invalid = { code: 'invalid-release', filepath: 'pages/page.json', message: 'invalid' };
            const wholeTree = { code: 'too-many-objects', filepath: '', message: 'too many' };
            compilation.report.problems.push(tooLarge, invalid, wholeTree);

            const content = await createCompiledContent(compilation);

            const about = content.getPageProblems('/about');
            assertEqual(2, about.length);
            assert(about.includes(tooLarge));
            assert(about.includes(invalid));

            // Every page inherits the metadata of the root page.json.
            assertList([ 'invalid-release' ], content.getPageProblems('/').map(({ code }) => code));
            assertList([ 'invalid-release' ], content.getPageProblems('/admin').map(({ code }) => code));
        });

        it('blocks exactly the pages that reach a broken global partial', async () => {
            const files = makeProjectFiles();
            files['templates/partials/nav.html'] = '<nav>{{#if}}</nav>';

            const content = await createCompiledContent(await compile(files));

            assertList([ 'templates/partials/nav.html' ], content.getPageProblems('/').map(({ filepath }) => filepath));
            assertList([], content.getPageProblems('/about'));
            assertList([], content.getPageProblems('/admin'));
            assertList([], content.getBaseTemplateProblems('default.html'));
        });

        it('reports a broken base template for its id and for no page', async () => {
            const files = makeProjectFiles();
            files['templates/base/default.html'] = '<html>{{#if}}</html>';

            const compilation = await compile(files);
            const content = await createCompiledContent(compilation);
            const problems = content.getBaseTemplateProblems('default.html');

            assertEqual(1, problems.length);
            assertEqual('templates/base/default.html', problems[0].filepath);
            assert(compilation.report.problems.includes(problems[0]));
            assertList([], content.getBaseTemplateProblems('plain.html'));

            for (const pathname of [ '/', '/about', '/admin' ]) {
                assertList([], content.getPageProblems(pathname));
            }
        });

        it('reports an empty base template', async () => {
            const files = makeProjectFiles();
            files['templates/base/plain.html'] = '';

            const content = await createCompiledContent(await compile(files));

            assertList([ 'empty-template' ], content.getBaseTemplateProblems('plain.html').map(({ code }) => code));
        });

        it('blocks a base template that reaches a broken global partial', async () => {
            const files = makeProjectFiles();
            files['templates/partials/footer.html'] = '<footer>{{#if}}</footer>';

            const content = await createCompiledContent(await compile(files));

            assertList(
                [ 'templates/partials/footer.html' ],
                content.getBaseTemplateProblems('default.html').map(({ filepath }) => filepath),
            );
            assertList([], content.getBaseTemplateProblems('plain.html'));
        });
    });

    group('a tree whose objects can\'t form an index', ({ it }) => {
        // The file `a` is published where `a/b` needs a directory.
        function makeUnservableFiles() {
            const files = makeProjectFiles();
            files['static-assets/a'] = 'file';
            files['public/a/b'] = 'file beneath it';
            return files;
        }

        it('has an empty index', async () => {
            const { snapshot } = await openSnapshot(await compile(makeUnservableFiles()));

            assertEqual(null, await snapshot.batchGetPageAssets(CONTEXT, '/'));
            assertEqual(0, snapshot.listStaticAssets().length);
            assertEqual(null, snapshot.statGlobalTemplatePartials());
        });

        it('reports the same problems for every page, and none for a pathname that is no page', async () => {
            const compilation = await compile(makeUnservableFiles());
            const content = await createCompiledContent(compilation);
            const problems = content.getPageProblems('/');

            assert(problems.length > 0);
            assert(problems.some(({ code }) => code === 'invalid-release'));
            assertEqual(problems, content.getPageProblems('/about'));
            assertList([], content.getPageProblems('/no/such/page'));
            assertEqual(problems, content.problems);

            for (const problem of compilation.report.problems) {
                assert(problems.includes(problem), 'every report problem is listed');
            }
        });

        it('lists a problem the compiler already reported once', async () => {
            // With no other problem the compiler's own backstop reports the
            // collision, so nothing is added.
            const compilation = await compile(makeUnservableFiles());
            const content = await createCompiledContent(compilation);

            assertEqual(1, compilation.report.problems.length);
            assertEqual(1, content.getPageProblems('/').length);
        });

        it('adds the index problem when the compiler\'s backstop didn\'t run', async () => {
            // The backstop runs only on a tree with no other problem.
            const files = makeUnservableFiles();
            files['pages/about/page.html'] = '<main>{{#if}}</main>';

            const compilation = await compile(files);
            const content = await createCompiledContent(compilation);
            const problems = content.getPageProblems('/');

            assertEqual(false, compilation.report.problems.some(({ code }) => code === 'invalid-release'));
            assertEqual(compilation.report.problems.length + 1, problems.length);

            const added = problems.at(-1);
            assertEqual('invalid-release', added.code);
            assertEqual('', added.filepath);
            assertEqual('string', typeof added.source);
            assert(added.message.includes(added.source));
        });
    });

    group('listContentDirectories()', ({ it }) => {
        it('lists the project\'s four directories, then each plugin root\'s', () => {
            assertList(
                [
                    'pages',
                    'templates',
                    'static-assets',
                    'public',
                    'plugins/admin/pages',
                    'plugins/admin/templates',
                    'plugins/admin/static-assets',
                ],
                listContentDirectories([ ADMIN_ROOT ]),
            );
        });

        it('lists only the project\'s directories when no plugin has content', () => {
            assertList([ 'pages', 'templates', 'static-assets', 'public' ], listContentDirectories());
        });

        it('lists a directory once', () => {
            const directories = listContentDirectories([
                { plugin: 'one', pagesDirectory: 'shared/pages' },
                { plugin: 'two', pagesDirectory: 'shared/pages', templatesDirectory: 'two/templates' },
            ]);

            assertList(
                [ 'pages', 'templates', 'static-assets', 'public', 'shared/pages', 'two/templates' ],
                directories,
            );
        });

        it('names every directory a compile reads', async () => {
            const source = createMemoryContentSource(makeProjectFiles());
            const listed = [];
            const read = [];

            await compileContent({
                source: {
                    async listFiles(directory) {
                        listed.push(directory);
                        return await source.listFiles(directory);
                    },
                    async readFile(path) {
                        read.push(path);
                        return await source.readFile(path);
                    },
                },
                pluginContentRoots: [ ADMIN_ROOT ],
                templateHelpers: [],
            });

            const directories = listContentDirectories([ ADMIN_ROOT ]);

            assert(listed.length > 0);
            assert(read.length > 0);

            for (const directory of listed) {
                assert(directories.includes(directory), `the compile listed "${ directory }"`);
            }

            for (const path of read) {
                assert(
                    directories.some((directory) => path.startsWith(`${ directory }/`)),
                    `the compile read "${ path }"`,
                );
            }
        });
    });
});
