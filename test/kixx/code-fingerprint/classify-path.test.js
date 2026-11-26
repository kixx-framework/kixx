import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { AssertionError } from '../../../kixx/assertions/mod.js';
import { PATH_CLASSES, classifyPath, createPathClassifier } from '../../../kixx/code-fingerprint/mod.js';
import * as tooling from '../../../kixx/tooling/mod.js';
import { createProjectFileSystem } from '../../../kixx/adapters/node/tooling/lib/project-file-system.js';


const PROJECT_DIRECTORY = fileURLToPath(new URL('../../fixtures/project/', import.meta.url));

// The fixture project's core is outside the project, as in this monorepo.
const CORE_DIRECTORY = '../../../kixx';

const VISITS_ROOTS = [{ plugin: 'visits', pagesDirectory: 'plugins/visits/pages' }];


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertClasses(cases, classify) {
    for (const [ path, expected ] of cases) {
        assertEqual(expected, classify(path), path);
    }
}


describe('classifyPath', ({ describe, it }) => {

    it('names exactly five classes', () => {
        assertEqual('agent,code,content,docs,test', Object.values(PATH_CLASSES).sort().join(','));
    });

    describe('content', ({ it }) => {
        it('classifies the root content directories as content', () => {
            assertClasses([
                [ 'pages/page.json', 'content' ],
                [ 'pages/blog/post/page.html', 'content' ],
                [ 'templates/base/default.html', 'content' ],
                [ 'static-assets/stylesheets/site.css', 'content' ],
                [ 'public/favicon.ico', 'content' ],
            ], (path) => classifyPath(path));
        });

        it('classifies an installed plugin content root as content', () => {
            assertClasses([
                [ 'plugins/visits/pages/x/page.json', 'content' ],
                [ 'plugins/visits/adapters/node/x.js', 'code' ],
                [ 'plugins/other/pages/x/page.json', 'code' ],
            ], (path) => classifyPath(path, VISITS_ROOTS));
        });

        it('lets content win over agent files and docs', () => {
            assertClasses([
                [ 'pages/AGENTS.md', 'content' ],
                [ 'pages/README.md', 'content' ],
                [ 'plugins/visits/pages/README.md', 'content' ],
                [ 'plugins/visits/pages/CLAUDE.md', 'content' ],
            ], (path) => classifyPath(path, VISITS_ROOTS));
        });

        it('matches a directory only at a segment boundary', () => {
            assertClasses([
                [ 'pagesx/a.js', 'code' ],
                [ 'public-api/a.js', 'code' ],
                [ 'plugins/visits/pagesx/a.js', 'code' ],
            ], (path) => classifyPath(path, VISITS_ROOTS));
        });
    });

    describe('agent files', ({ it }) => {
        it('classifies AGENTS.md and CLAUDE.md at any depth as agent files', () => {
            assertClasses([
                [ 'AGENTS.md', 'agent' ],
                [ 'CLAUDE.md', 'agent' ],
                [ 'app/AGENTS.md', 'agent' ],
                [ 'kixx/hyperview/CLAUDE.md', 'agent' ],
            ], (path) => classifyPath(path));
        });

        it('classifies the root agent directories as agent files', () => {
            assertClasses([
                [ '.agents/skills/x/SKILL.md', 'agent' ],
                [ '.claude/settings.json', 'agent' ],
                [ '.codex/config.toml', 'agent' ],
                [ 'app/.claude/settings.json', 'code' ],
            ], (path) => classifyPath(path));
        });

        it('classifies shipped agent sources in core and plugins as agent files', () => {
            assertClasses([
                [ 'kixx/agents/x/SKILL.md', 'agent' ],
                [ 'kixx/agents/x/script.js', 'agent' ],
                [ 'plugins/visits/agents/skill/SKILL.md', 'agent' ],
                [ 'kixx/plugins/agents/x.js', 'code' ],
                [ 'app/agents/x.js', 'code' ],
            ], (path) => classifyPath(path));
        });
    });

    describe('tests', ({ it }) => {
        it('classifies the root test directory as tests, over docs', () => {
            assertClasses([
                [ 'test/app/app.test.js', 'test' ],
                [ 'test/fixtures/page.json', 'test' ],
                [ 'test/README.md', 'test' ],
                [ 'app/test/x.js', 'code' ],
                [ 'tests/x.js', 'code' ],
            ], (path) => classifyPath(path));
        });
    });

    describe('docs', ({ it }) => {
        it('classifies the root docs directory and every Markdown file as docs', () => {
            assertClasses([
                [ 'docs/guide.html', 'docs' ],
                [ 'README.md', 'docs' ],
                [ 'CHANGELOG.md', 'docs' ],
                [ 'kixx/hyperview/README.md', 'docs' ],
                [ 'kixx/content-compiler/README.md', 'docs' ],
                [ 'plugins/visits/README.md', 'docs' ],
                [ 'app/NOTES.MD', 'docs' ],
                [ 'app/notes.Md', 'docs' ],
                [ 'app/docs/x.js', 'code' ],
            ], (path) => classifyPath(path, VISITS_ROOTS));
        });

        it('classifies license files at the root as docs', () => {
            assertClasses([
                [ 'LICENSE', 'docs' ],
                [ 'LICENSE.txt', 'docs' ],
                [ 'LICENCE', 'docs' ],
                [ 'LICENCE-MIT', 'docs' ],
                [ 'kixx/LICENSE', 'code' ],
                [ 'license', 'code' ],
            ], (path) => classifyPath(path));
        });
    });

    describe('code', ({ it }) => {
        it('classifies everything else as code, tooling files included (D40)', () => {
            assertClasses([
                [ 'kixx/hyperview/hyperview-service.js', 'code' ],
                [ 'kixx/plugin.json', 'code' ],
                [ 'plugins/visits/plugin.json', 'code' ],
                [ 'app/app.json', 'code' ],
                [ 'app/app.js', 'code' ],
                [ 'routes/site.jsonc', 'code' ],
                [ 'virtual-hosts.js', 'code' ],
                [ 'node-server.js', 'code' ],
                [ 'cloudflare-server.js', 'code' ],
                [ 'node-registry.generated.js', 'code' ],
                [ 'node-config.jsonc', 'code' ],
                [ 'cloudflare-config.jsonc', 'code' ],
                [ 'package.json', 'code' ],
                [ 'deno.json', 'code' ],
                [ 'example.env', 'code' ],
                [ 'example.env.secrets', 'code' ],
                [ '.env.production', 'code' ],
                [ '.env.development', 'code' ],
                [ '.github/workflows/ci.yml', 'code' ],
                [ '.kixx/state.json', 'code' ],
                [ 'kixx.lock.json', 'code' ],
                [ 'package-lock.json', 'code' ],
                [ 'deno.lock', 'code' ],
                [ '.gitignore', 'code' ],
                [ '.gitattributes', 'code' ],
                [ '.editorconfig', 'code' ],
                [ 'eslint.config.js', 'code' ],
                [ 'Pages/page.json', 'code' ],
            ], (path) => classifyPath(path));
        });
    });

    describe('invalid paths', ({ it }) => {
        it('throws an AssertionError naming the path', () => {
            const paths = [
                '',
                '/pages/page.json',
                'pages/',
                'pages//page.json',
                './pages/page.json',
                'pages/../app.js',
                'a\0b',
                'a\uD800b',
                'a\uDC00',
            ];

            for (const path of paths) {
                const error = catchError(() => classifyPath(path));
                assert(error instanceof AssertionError, JSON.stringify(path));
                assertMatches(JSON.stringify(path), error.message);
            }
        });

        it('throws for a path that is not a string', () => {
            assert(catchError(() => classifyPath(42)) instanceof AssertionError);
        });

        it('accepts a well-formed surrogate pair', () => {
            assertEqual('code', classifyPath('app/😀.js'));
        });
    });
});

describe('createPathClassifier', ({ it }) => {

    it('classifies the fixture project plugin content from listPluginContentRoots()', async () => {
        const installation = await tooling.readInstallation({
            fileSystem: createProjectFileSystem(PROJECT_DIRECTORY),
            coreDirectory: CORE_DIRECTORY,
        });

        const contentRoots = tooling.listPluginContentRoots(installation, { coreDirectory: CORE_DIRECTORY });
        const classify = tooling.createPathClassifier(contentRoots);

        assertEqual('content', classify('plugins/visits/pages/visits/page.json'));
        assertEqual('code', classify('plugins/visits/plugin.json'));
    });

    it('is importable from the tooling entry', () => {
        assertEqual(classifyPath, tooling.classifyPath);
        assertEqual(createPathClassifier, tooling.createPathClassifier);
        assertEqual(PATH_CLASSES, tooling.PATH_CLASSES);
    });

    it('ignores a root outside the project', () => {
        const classify = createPathClassifier([{ plugin: 'kixx', pagesDirectory: '../kixx/pages' }]);
        assertEqual('code', classify('kixx/pages/page.json'));
    });

    it('normalizes a root with a leading ./ or a trailing /', () => {
        const classify = createPathClassifier([
            { plugin: 'a', pagesDirectory: './plugins/a/pages' },
            { plugin: 'b', templatesDirectory: 'plugins/b/templates/' },
            { plugin: 'kixx', staticAssetsDirectory: 'kixx/static-assets' },
        ]);

        assertEqual('content', classify('plugins/a/pages/page.json'));
        assertEqual('content', classify('plugins/b/templates/base.html'));
        assertEqual('content', classify('kixx/static-assets/site.css'));
        assertEqual('code', classify('plugins/a/plugin.json'));
    });

    it('throws for an absolute root or one containing ..', () => {
        for (const directory of [ '/plugins/a/pages', 'plugins/../a/pages', 'plugins/a/..', '' ]) {
            const error = catchError(() => createPathClassifier([{ plugin: 'a', pagesDirectory: directory }]));
            assert(error instanceof AssertionError, JSON.stringify(directory));
        }
    });

    it('throws when contentRoots is not an array of plain objects', () => {
        assert(catchError(() => createPathClassifier({})) instanceof AssertionError);
        assert(catchError(() => createPathClassifier([ 'plugins/a/pages' ])) instanceof AssertionError);
    });
});
