import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ContentAddressableStore from '../../../../../../kixx/content-addressable-store/content-addressable-store.js';
import { createWorkingTreeContent } from '../../../../../../kixx/adapters/node/content-compiler/lib/working-tree-content.js';


const ADMIN_ROOT = { plugin: 'admin', pagesDirectory: 'plugins/admin/pages' };

const CONTEXT = { name: 'test-request-context' };

const PROJECT_FILES = {
    'pages/page.json': JSON.stringify({ template: 'page.html' }),
    'pages/page.html': '<main>Home</main>',
    'pages/about/page.json': JSON.stringify({ template: 'page.html' }),
    'pages/about/page.html': '<main>About</main>',
    'templates/base/default.html': '<html>{{{ body }}}</html>',
    'static-assets/site.css': '@import "./lib/reset.css";\na { color: red; }',
    'static-assets/lib/reset.css': 'b { margin: 0; }',
    'public/robots.txt': 'User-agent: *',
    'plugins/admin/pages/admin/page.json': JSON.stringify({ template: 'page.html' }),
    'plugins/admin/pages/admin/page.html': '<main>Admin</main>',
    'app/app.js': 'export default {};',
};

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

// Records what the supplier's child logger is told.
function makeLogger() {
    const entries = [];
    const names = [];
    const child = {};

    for (const level of [ 'debug', 'info', 'warn', 'error' ]) {
        child[level] = (message, info) => entries.push({ level, message, info });
    }

    return {
        entries,
        names,
        createChild(name) {
            names.push(name);
            return child;
        },
        // One 'info' line is logged per compilation.
        get compileCount() {
            return entries.filter((entry) => entry.level === 'info').length;
        },
    };
}

// A real store over a content store port that is never reached, so every
// read comes from the supplied content.
function makeStore() {
    const child = { debug() {}, info() {}, warn() {}, error() {}, createChild: () => child };
    const store = new ContentAddressableStore();
    store.initialize({ logger: { createChild: () => child }, contentStore: {} });
    return store;
}

async function readStream(stream) {
    return await new Response(stream).text();
}

describe('node working tree content', ({ before, after, describe }) => {
    let tempDirectory;
    let treeCount = 0;

    before(async () => {
        tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-working-tree-'));
    });

    after(async () => {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
    });

    function resolveFile(projectDirectory, relativePath) {
        return path.join(projectDirectory, ...relativePath.split('/'));
    }

    async function writeFile(projectDirectory, relativePath, content) {
        const filepath = resolveFile(projectDirectory, relativePath);

        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, content);
    }

    // Writes a project to its own directory and resolves a supplier over it.
    async function makeProject(files = PROJECT_FILES, options = {}) {
        treeCount += 1;

        const projectDirectory = path.join(tempDirectory, `project-${ treeCount }`);
        await fsp.mkdir(projectDirectory, { recursive: true });

        for (const [ relativePath, content ] of Object.entries(files)) {
            await writeFile(projectDirectory, relativePath, content);
        }

        const logger = makeLogger();
        const workingTree = createWorkingTreeContent({
            projectDirectory,
            contentRoots: [ ADMIN_ROOT ],
            templateHelpers: [],
            logger,
            ...options,
        });

        return { projectDirectory, logger, workingTree };
    }

    // Applies a change and asserts whether the next call compiles again.
    async function assertChange(expectRecompile, change) {
        const { projectDirectory, logger, workingTree } = await makeProject();
        const first = await workingTree.getContent();

        await change(projectDirectory);

        const second = await workingTree.getContent();

        assertEqual(expectRecompile, second !== first);
        assertEqual(expectRecompile ? 2 : 1, logger.compileCount);
    }

    describe('createWorkingTreeContent()', ({ it }) => {
        it('requires a project directory and a logger', () => {
            const logger = makeLogger();
            const cases = [
                [ undefined, 'options' ],
                [ { logger }, 'projectDirectory' ],
                [ { projectDirectory: tempDirectory }, 'logger' ],
                [ { projectDirectory: tempDirectory, logger, contentRoots: {} }, 'contentRoots' ],
            ];

            for (const [ options, expected ] of cases) {
                let caught = null;

                try {
                    createWorkingTreeContent(options);
                } catch (error) {
                    caught = error;
                }

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches(expected, caught.message);
            }
        });
    });

    describe('getContent() with no change', ({ it }) => {
        it('compiles once and returns the same content object', async () => {
            const { logger, workingTree } = await makeProject();

            const first = await workingTree.getContent();
            const second = await workingTree.getContent();

            assert(first === second, 'expected the same content object');
            assertEqual(1, logger.compileCount);
        });

        it('logs one info line for the compilation and nothing on the next call', async () => {
            const { logger, workingTree } = await makeProject();

            await workingTree.getContent();

            assertEqual('WorkingTreeContent', logger.names.join(','));
            assertEqual(1, logger.entries.length);
            assertEqual('info', logger.entries[0].level);
            assertEqual(0, logger.entries[0].info.problems);
            assert(logger.entries[0].info.objects > 0, 'expected an object count');
            assertEqual('number', typeof logger.entries[0].info.milliseconds);

            await workingTree.getContent();

            assertEqual(1, logger.entries.length);
        });

        it('does not compile again when a file outside the content directories changes', async () => {
            await assertChange(false, async (projectDirectory) => {
                await writeFile(projectDirectory, 'app/app.js', 'export default { changed: true };');
                await writeFile(projectDirectory, 'notes.txt', 'new');
            });
        });
    });

    describe('getContent() after a change', ({ it }) => {
        it('compiles again when a file\'s content and size change', async () => {
            await assertChange(true, async (projectDirectory) => {
                await writeFile(projectDirectory, 'pages/page.html', '<main>Home, but longer</main>');
            });
        });

        it('compiles again when a file\'s modified time changes and its size does not', async () => {
            await assertChange(true, async (projectDirectory) => {
                const filepath = resolveFile(projectDirectory, 'pages/page.html');
                const { size } = await fsp.stat(filepath);

                // Set the time, so the test doesn't depend on the clock's
                // granularity.
                await fsp.utimes(filepath, new Date(2020, 0, 1), new Date(2020, 0, 1));

                assertEqual(size, (await fsp.stat(filepath)).size);
            });
        });

        it('compiles again when a file is added', async () => {
            await assertChange(true, async (projectDirectory) => {
                await writeFile(projectDirectory, 'pages/new/page.json', JSON.stringify({ template: 'page.html' }));
                await writeFile(projectDirectory, 'pages/new/page.html', '<main>New</main>');
            });
        });

        it('compiles again when a file is removed', async () => {
            await assertChange(true, async (projectDirectory) => {
                await fsp.rm(resolveFile(projectDirectory, 'static-assets/lib/reset.css'));
            });
        });

        it('compiles again when a file is renamed', async () => {
            await assertChange(true, async (projectDirectory) => {
                await fsp.rename(
                    resolveFile(projectDirectory, 'public/robots.txt'),
                    resolveFile(projectDirectory, 'public/humans.txt'),
                );
            });
        });

        it('compiles again when a plugin content root changes', async () => {
            await assertChange(true, async (projectDirectory) => {
                await writeFile(projectDirectory, 'plugins/admin/pages/admin/page.html', '<main>Admin, edited</main>');
            });
        });

        it('compiles again when a file under public/ changes', async () => {
            await assertChange(true, async (projectDirectory) => {
                await writeFile(projectDirectory, 'public/robots.txt', 'User-agent: *\nDisallow: /admin');
            });
        });

        it('serves the changed content', async () => {
            const { projectDirectory, workingTree } = await makeProject();
            const first = await workingTree.getContent();

            await writeFile(projectDirectory, 'public/robots.txt', 'Disallow: /');

            const second = await workingTree.getContent();
            const before = first.index.getNode('/assets/robots.txt') ?? null;
            const after = second.index.getNode('/assets/robots.txt') ?? null;

            assert(before && after, 'expected robots.txt in both indexes');
            assert(before.hash !== after.hash, 'expected a new content hash');
            assertEqual('Disallow: /', await second.objects.getFile(CONTEXT, 'text', '', after.hash));
        });

        it('compiles once for ten concurrent calls on a changed tree', async () => {
            const { projectDirectory, logger, workingTree } = await makeProject();
            const first = await workingTree.getContent();

            await writeFile(projectDirectory, 'pages/page.html', '<main>Changed for everyone</main>');

            const results = await Promise.all(Array.from({ length: 10 }, () => workingTree.getContent()));

            assert(results[0] !== first, 'expected a new compilation');
            assert(results.every((content) => content === results[0]), 'expected one shared compilation');
            assertEqual(2, logger.compileCount);
        });
    });

    describe('getContent() and the shape of the tree', ({ it }) => {
        it('works when a content directory is missing, and sees it appear later', async () => {
            const { projectDirectory, logger, workingTree } = await makeProject({
                'pages/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/page.html': '<main>Home</main>',
            });

            const first = await workingTree.getContent();
            assert(first === await workingTree.getContent(), 'expected no recompile');

            await writeFile(projectDirectory, 'public/robots.txt', 'User-agent: *');

            const second = await workingTree.getContent();

            assert(second !== first, 'expected a new compilation');
            assertEqual(2, logger.compileCount);
            assert(second.index.getNode('/assets/robots.txt'), 'expected robots.txt to be served');
        });

        it('works when the project has no content at all', async () => {
            const { workingTree } = await makeProject({ 'app/app.js': '' });

            const content = await workingTree.getContent();

            assertEqual(0, content.getPageProblems('/').length);
        });

        it('records a symbolic link and never follows it', async () => {
            const { projectDirectory, logger, workingTree } = await makeProject();
            const outside = path.join(projectDirectory, 'outside');

            await writeFile(projectDirectory, 'outside/secret.txt', 'one');

            const first = await workingTree.getContent();

            // Recorded: adding the link changes the signature.
            await fsp.symlink(outside, resolveFile(projectDirectory, 'public/linked'));
            const second = await workingTree.getContent();

            assert(second !== first, 'expected the link to be seen');

            // Never followed: a change behind the link changes nothing.
            await writeFile(projectDirectory, 'outside/secret.txt', 'two, and longer');
            await writeFile(projectDirectory, 'outside/more.txt', 'more');
            const third = await workingTree.getContent();

            assert(third === second, 'expected no recompile for a change behind a link');
            assertEqual(2, logger.compileCount);
        });
    });

    describe('getContent() when the compile rejects', ({ it }) => {
        it('lets the error through and compiles again on the next call', async () => {
            // A plugin content root outside the project is refused by the
            // compiler before anything is read.
            const { workingTree } = await makeProject(PROJECT_FILES, {
                contentRoots: [ { plugin: 'unsafe', pagesDirectory: '../elsewhere/pages' } ],
            });

            const first = await catchRejection(workingTree.getContent());
            const second = await catchRejection(workingTree.getContent());

            assert(first, 'expected a rejection');
            assertEqual('ValidationError', first.name);
            assert(second, 'expected a second rejection');
            assert(second !== first, 'expected a second compile, not the cached rejection');
        });
    });

    describe('getContent() with content problems', ({ it }) => {
        it('logs one warning per problem, still returns content, and logs nothing when unchanged', async () => {
            const { logger, workingTree } = await makeProject({
                ...PROJECT_FILES,
                'pages/about/page.html': '<main>{{#if }}</main>',
            });

            const content = await workingTree.getContent();
            const warnings = logger.entries.filter((entry) => entry.level === 'warn');

            assert(content.problems.length > 0, 'expected a problem');
            assertEqual(content.problems.length, warnings.length);
            assertEqual(content.problems.length, logger.entries[0].info.problems);

            for (const [ index, problem ] of content.problems.entries()) {
                assertEqual(problem.code, warnings[index].info.code);
                assertEqual(problem.message, warnings[index].info.message);
                assertEqual(problem.filepath, warnings[index].info.filepath);
            }

            assert(content.getPageProblems('/about').length > 0, 'expected the page to be blocked');
            assertEqual(0, content.getPageProblems('/').length);

            const count = logger.entries.length;
            assert(content === await workingTree.getContent(), 'expected no recompile');
            assertEqual(count, logger.entries.length);
        });
    });

    describe('the content through ContentAddressableStore', ({ it }) => {
        it('serves a page, a plugin page, a public file, and a bundled stylesheet by hash', async () => {
            const { workingTree } = await makeProject();
            const store = makeStore();

            store.supplyContent(CONTEXT, await workingTree.getContent());

            const snapshot = await store.openSnapshot(CONTEXT);

            const about = await snapshot.batchGetPageAssets(CONTEXT, '/about');
            const admin = await snapshot.batchGetPageAssets(CONTEXT, '/admin');
            assertEqual('<main>About</main>', about.template.text);
            assertEqual('<main>Admin</main>', admin.template.text);

            const robots = await snapshot.getStaticAsset(CONTEXT, '/robots.txt');
            assertEqual('User-agent: *', await readStream(robots.stream));

            const stylesheet = snapshot.statStaticAsset('/site.css');
            const stream = await store.getStaticAssetByHash(CONTEXT, '/site.css', stylesheet.hash);
            const css = await readStream(stream);

            // Bundled: the import is replaced by the imported file.
            assertMatches('margin: 0', css);
            assertMatches('color: red', css);
            assert(!css.includes('@import'), 'expected the @import to be bundled');
        });
    });
});
