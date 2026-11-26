import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
} from 'kixx-assert';

import { compileContent, createMemoryContentSource } from '../../../kixx/content-compiler/mod.js';


const HELPERS = [ 'if', 'each', 'unescape', 'formatDate' ];

function compile(files, options) {
    const { templateHelpers = HELPERS, pluginContentRoots = [] } = options ?? {};

    return compileContent({
        source: createMemoryContentSource(files),
        pluginContentRoots,
        templateHelpers,
    });
}

// A page at `pathname` whose template is `source`.
function makePage(pathname, source, manifest) {
    const directory = pathname === '/' ? 'pages' : `pages${ pathname }`;

    return {
        [`${ directory }/page.json`]: JSON.stringify({ template: 'page.html', ...manifest }),
        [`${ directory }/page.html`]: source,
    };
}

function summarize(problems) {
    return problems.map(({ code, filepath, line }) => `${ code } ${ filepath } ${ line }`).join('\n');
}

describe('content-compiler/check-templates', ({ describe: group }) => {

    group('a template with a syntax error (CONT-8)', ({ it }) => {
        it('is a template-syntax-error on a page template, with its line and page', async () => {
            const result = await compile(makePage('/about', '<main>\n{{#if a}}\n</main>'));

            assertEqual(JSON.stringify([ {
                code: 'template-syntax-error',
                filepath: 'pages/about/page.html',
                message: 'Failed to close block opened in pages/about/page.html on line 2',
                line: 2,
                page: '/about',
            } ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('is a template-syntax-error on a page partial', async () => {
            const result = await compile({
                ...makePage('/about', '<main></main>', { partials: [ { id: 'bio', filename: 'bio.html' } ] }),
                'pages/about/bio.html': 'a\nb\n{{/if}}',
            });

            assertEqual('template-syntax-error pages/about/bio.html 3', summarize(result.report.problems));
            assertEqual('/about', result.report.problems[0].page);
            assertEqual(null, result.release);
        });

        it('is a template-syntax-error on a global partial', async () => {
            const result = await compile({ 'templates/partials/nav.html': '{{#each items}}' });

            assertEqual('template-syntax-error templates/partials/nav.html 1', summarize(result.report.problems));
            assertFalsy(Object.hasOwn(result.report.problems[0], 'page'));
            assertEqual(null, result.release);
        });

        it('is a template-syntax-error on a base template', async () => {
            const result = await compile({ 'templates/base/default.html': '<html>\n{{/each}}' });

            assertEqual('template-syntax-error templates/base/default.html 2', summarize(result.report.problems));
            assertEqual(null, result.release);
        });

        it('has no line when the engine throws an error of its own kind', async () => {
            const result = await compile(makePage('/', '{{"x" y}}'));

            assertEqual(1, result.report.problems.length);

            const [ problem ] = result.report.problems;
            assertEqual('template-syntax-error', problem.code);
            assertEqual('pages/page.html', problem.filepath);
            assertFalsy(Object.hasOwn(problem, 'line'));
            assert(problem.message.startsWith('Template "pages/page.html" cannot be compiled: '), problem.message);
            assertEqual(null, result.release);
        });

        it('reports only the first error of a template', async () => {
            const result = await compile(makePage('/', '{{nope a}}\n{{/if}}'));

            assertEqual(1, result.report.problems.length);
        });
    });

    group('a helper that is not declared (CONT-8)', ({ it }) => {
        // The compiler tells an undeclared helper from any other compile
        // failure by the engine's wording. If a new engine version rewords
        // it, this fails.
        it('is an unregistered-helper, as an expression', async () => {
            const result = await compile(makePage('/', '<main>\n{{nope a}}</main>'));

            assertEqual(JSON.stringify([ {
                code: 'unregistered-helper',
                filepath: 'pages/page.html',
                message: 'Template helper "nope" is used in "pages/page.html" on line 2 but is not declared. Declare it under "templateHelpers" in the manifest of the app or plugin that registers it.',
                helper: 'nope',
                line: 2,
                page: '/',
            } ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('is an unregistered-helper, as a block', async () => {
            const result = await compile({ 'templates/base/default.html': '{{#nope a}}x{{/nope}}' });

            assertEqual('unregistered-helper templates/base/default.html 1', summarize(result.report.problems));
            assertEqual('nope', result.report.problems[0].helper);
        });

        it('compiles when the name is declared', async () => {
            const files = {
                ...makePage('/', '{{nope a}}'),
                'templates/base/default.html': '{{#nope a}}x{{/nope}}',
            };
            const result = await compile(files, { templateHelpers: [ 'nope' ] });

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
        });

        it('checks against the declared names only', async () => {
            const result = await compile(makePage('/', '{{#if a}}{{formatDate b}}{{/if}}'), { templateHelpers: [ 'if' ] });

            assertEqual('formatDate', result.report.problems.map(({ helper }) => helper).join());
        });

        // Known limit: with no arguments, the engine reads a name as a data
        // lookup and a block as a section, so neither can be caught.
        it('cannot catch an undeclared name used with no arguments', async () => {
            const result = await compile(makePage('/', '{{formatDat}}{{#nope}}x{{/nope}}'));

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
        });
    });

    group('a partial reference in a page', ({ it }) => {
        it('resolves to a page partial and to a global partial', async () => {
            const result = await compile({
                ...makePage('/about', '{{> bio }}{{> nav.html }}', { partials: [ { id: 'bio', filename: 'bio.html' } ] }),
                'pages/about/bio.html': '<p>{{> nav.html }}</p>',
                'templates/partials/nav.html': '<nav></nav>',
            });

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
        });

        it('is a missing-partial when neither the page nor the global partials have it', async () => {
            const result = await compile({
                ...makePage('/about', '<main>\n{{> gone.html }}</main>', { partials: [ { id: 'bio', filename: 'bio.html' } ] }),
                'pages/about/bio.html': '{{> also-gone }}',
                'templates/partials/nav.html': '<nav></nav>',
            });

            assertEqual(JSON.stringify([
                {
                    code: 'missing-partial',
                    filepath: 'pages/about/page.html',
                    message: 'Partial "gone.html" referenced in "pages/about/page.html" on line 2 does not exist',
                    partial: 'gone.html',
                    line: 2,
                    page: '/about',
                },
                {
                    code: 'missing-partial',
                    filepath: 'pages/about/bio.html',
                    message: 'Partial "also-gone" referenced in "pages/about/bio.html" on line 1 does not exist',
                    partial: 'also-gone',
                    line: 1,
                    page: '/about',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('does not resolve to another page\'s partial', async () => {
            const result = await compile({
                ...makePage('/about', '<main></main>', { partials: [ { id: 'bio', filename: 'bio.html' } ] }),
                'pages/about/bio.html': '<p></p>',
                ...makePage('/contact', '{{> bio }}'),
            });

            assertEqual('missing-partial pages/contact/page.html 1', summarize(result.report.problems));
        });

        it('finds a reference inside a block and after an else', async () => {
            const result = await compile(makePage('/', [
                '{{#if a}}',
                '{{#each items}}{{> one }}{{/each}}',
                '{{else}}',
                '{{> two }}',
                '{{/if}}',
            ].join('\n')));

            assertEqual(
                'missing-partial pages/page.html 2\nmissing-partial pages/page.html 4',
                summarize(result.report.problems),
            );
            assertEqual('one,two', result.report.problems.map(({ partial }) => partial).join());
        });

        it('looks the whole expression up, as the engine does', async () => {
            const result = await compile({
                ...makePage('/', '{{> "nav.html" a=1 }}'),
                'templates/partials/nav.html': '<nav></nav>',
            });

            assertEqual('"nav.html" a=1', result.report.problems.map(({ partial }) => partial).join());
        });

        it('reads the references of a template that fails on a helper', async () => {
            const result = await compile(makePage('/', '{{> gone }}{{nope a}}'));

            assertEqual('unregistered-helper,missing-partial', result.report.problems.map(({ code }) => code).join());
        });

        it('does not report a reference to a declared partial whose file is already a problem', async () => {
            const result = await compile(makePage('/', '{{> bio }}', { partials: [ { id: 'bio', filename: 'bio.html' } ] }));

            assertEqual('missing-referenced-file', result.report.problems.map(({ code }) => code).join());
        });
    });

    group('a partial reference in a global partial or a base template', ({ it }) => {
        it('resolves to a global partial', async () => {
            const result = await compile({
                'templates/partials/nav.html': '<nav>{{> nav/item.html }}</nav>',
                'templates/partials/nav/item.html': '<a></a>',
                'templates/base/default.html': '<html>{{> nav.html }}</html>',
            });

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
        });

        it('is a missing-partial when no global partial has the id', async () => {
            const result = await compile({
                'templates/partials/nav.html': '<nav>\n\n{{> gone.html }}</nav>',
                'templates/base/default.html': '<html>{{> missing.html }}</html>',
            });

            assertEqual(JSON.stringify([
                {
                    code: 'missing-partial',
                    filepath: 'templates/partials/nav.html',
                    message: 'Partial "gone.html" referenced in "templates/partials/nav.html" on line 3 does not exist',
                    partial: 'gone.html',
                    line: 3,
                },
                {
                    code: 'missing-partial',
                    filepath: 'templates/base/default.html',
                    message: 'Partial "missing.html" referenced in "templates/base/default.html" on line 1 does not exist',
                    partial: 'missing.html',
                    line: 1,
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('is a missing-partial, once, when only pages supply the partial', async () => {
            const partials = [ { id: 'sidebar', filename: 'sidebar.html' } ];
            const result = await compile({
                ...makePage('/a', '{{> nav.html }}', { partials }),
                'pages/a/sidebar.html': '<aside></aside>',
                ...makePage('/b', '{{> nav.html }}', { partials }),
                'pages/b/sidebar.html': '<aside></aside>',
                'templates/partials/nav.html': '<nav>{{> sidebar }}</nav>',
                'templates/base/default.html': '<html>{{> sidebar }}</html>',
            });

            assertEqual(
                'missing-partial templates/partials/nav.html 1\nmissing-partial templates/base/default.html 1',
                summarize(result.report.problems),
            );
        });
    });

    group('an empty template', ({ it }) => {
        it('is an empty-template for a page partial, a global partial, and a base template', async () => {
            const result = await compile({
                ...makePage('/about', '<main></main>', { partials: [ { id: 'bio', filename: 'bio.html' } ] }),
                'pages/about/bio.html': '',
                'templates/partials/nav.html': '',
                'templates/base/default.html': '',
            });

            assertEqual(JSON.stringify([
                {
                    code: 'empty-template',
                    filepath: 'pages/about/bio.html',
                    message: 'Template "pages/about/bio.html" is empty',
                    page: '/about',
                },
                {
                    code: 'empty-template',
                    filepath: 'templates/partials/nav.html',
                    message: 'Template "templates/partials/nav.html" is empty',
                },
                {
                    code: 'empty-template',
                    filepath: 'templates/base/default.html',
                    message: 'Template "templates/base/default.html" is empty',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('stays an empty-page-template for a page template', async () => {
            const result = await compile(makePage('/', ''));

            assertEqual('empty-page-template', result.report.problems.map(({ code }) => code).join());
        });
    });

    group('the title and description templates in a page.json', ({ it }) => {
        it('compile when they are sound', async () => {
            const result = await compile(makePage('/', '<main></main>', {
                page: {
                    title: { template: '{{ name }} | {{formatDate published}}' },
                    description: { template: 'About {{ name }}' },
                },
            }));

            assertEqual('[]', JSON.stringify(result.report.problems));
        });

        it('are reported on the page.json, with the field', async () => {
            const result = await compile(makePage('/about', '<main></main>', {
                page: {
                    title: { template: '{{nope name}}' },
                    description: { template: '{{#if name}}' },
                },
            }));

            assertEqual(JSON.stringify([
                {
                    code: 'unregistered-helper',
                    filepath: 'pages/about/page.json',
                    message: 'Template helper "nope" is used in "pages/about/page.json" on line 1 but is not declared. Declare it under "templateHelpers" in the manifest of the app or plugin that registers it.',
                    helper: 'nope',
                    line: 1,
                    field: 'page.title.template',
                    page: '/about',
                },
                {
                    code: 'template-syntax-error',
                    filepath: 'pages/about/page.json',
                    message: 'Failed to close block opened in pages/about/page.json on line 1',
                    line: 1,
                    field: 'page.description.template',
                    page: '/about',
                },
            ], null, 2), JSON.stringify(result.report.problems, null, 2));
            assertEqual(null, result.release);
        });

        it('are checked on a page with no template of its own', async () => {
            const result = await compile({
                'pages/blog/page.json': JSON.stringify({ page: { title: { template: '{{nope a}}' } } }),
            });

            assertEqual('unregistered-helper', result.report.problems.map(({ code }) => code).join());
        });

        it('are ignored when they are not non-empty strings, and their partial references are not resolved', async () => {
            const result = await compile(makePage('/', '<main></main>', {
                page: {
                    title: { template: '' },
                    description: { template: '{{> anything }}' },
                },
            }));

            assertEqual('[]', JSON.stringify(result.report.problems));

            const other = await compile(makePage('/', '<main></main>', { page: { title: 'Plain', description: { template: 42 } } }));
            assertEqual('[]', JSON.stringify(other.report.problems));
        });
    });

    group('partials that include themselves', ({ it }) => {
        it('neither loop nor produce a problem, among page partials', async () => {
            const result = await compile({
                ...makePage('/', '{{> tree }}{{> a }}', {
                    partials: [
                        { id: 'tree', filename: 'tree.html' },
                        { id: 'a', filename: 'a.html' },
                        { id: 'b', filename: 'b.html' },
                    ],
                }),
                'pages/tree.html': '<ul>{{#each children}}{{> tree }}{{/each}}</ul>',
                'pages/a.html': '{{> b }}',
                'pages/b.html': '{{> a }}',
            });

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
        });

        it('neither loop nor produce a problem, among global partials', async () => {
            const result = await compile({
                ...makePage('/', '{{> tree.html }}{{> a.html }}'),
                'templates/partials/tree.html': '<ul>{{#each children}}{{> tree.html }}{{/each}}</ul>',
                'templates/partials/a.html': '{{> b.html }}',
                'templates/partials/b.html': '{{> a.html }}',
                'templates/base/default.html': '{{> a.html }}',
            });

            assertEqual('[]', JSON.stringify(result.report.problems));
            assert(result.release);
            assertEqual('a.html,b.html,tree.html', result.graph.pages[0].globalPartials.join());
            assertEqual('a.html,b.html', result.graph.baseTemplates[0].globalPartials.join());
        });
    });

    group('the per-page report', ({ it }) => {
        function makeFiles() {
            return {
                // Fails in its own template, and reaches the broken footer
                // through nav.html.
                ...makePage('/a', '{{> nav.html }}{{> gone }}'),
                // Sound itself. Reaches the broken footer through a page
                // partial, then nav.html.
                ...makePage('/b', '{{> side }}', { partials: [ { id: 'side', filename: 'side.html' } ] }),
                'pages/b/side.html': '{{> nav.html }}',
                // Sound, and reaches only a sound partial.
                ...makePage('/c', '{{> ok.html }}'),
                // Fails in its page.json.
                'pages/d/page.json': JSON.stringify({ template: 'gone.html' }),
                'templates/partials/nav.html': '<nav>{{> footer.html }}</nav>',
                'templates/partials/footer.html': '{{nope a}}',
                'templates/partials/ok.html': '<p></p>',
                'templates/partials/unused.html': '{{/if}}',
                'templates/base/default.html': '{{#if a}}',
                'static-assets/empty.txt': '',
            };
        }

        it('lists each failing page once, sorted, with its own problems and then those of the global partials it reaches', async () => {
            const { report } = await compile(makeFiles());

            assertEqual(JSON.stringify([
                {
                    pathname: '/a',
                    problems: [
                        'missing-partial pages/a/page.html',
                        'unregistered-helper templates/partials/footer.html',
                    ],
                },
                {
                    pathname: '/b',
                    problems: [
                        'unregistered-helper templates/partials/footer.html',
                    ],
                },
                {
                    pathname: '/d',
                    problems: [
                        'missing-referenced-file pages/d/page.json',
                    ],
                },
            ], null, 2), JSON.stringify(report.pages.map(({ pathname, problems }) => {
                return {
                    pathname,
                    problems: problems.map(({ code, filepath }) => `${ code } ${ filepath }`),
                };
            }), null, 2));
        });

        it('lists every problem once in report.problems: the scan\'s, then pages, global partials, and base templates', async () => {
            const { report } = await compile(makeFiles());

            assertEqual([
                'missing-referenced-file pages/d/page.json',
                'empty-static-asset static-assets/empty.txt',
                'missing-partial pages/a/page.html',
                'unregistered-helper templates/partials/footer.html',
                'template-syntax-error templates/partials/unused.html',
                'template-syntax-error templates/base/default.html',
            ].join('\n'), report.problems.map(({ code, filepath }) => `${ code } ${ filepath }`).join('\n'));
        });

        it('shares each problem object between the two lists', async () => {
            const { report } = await compile(makeFiles());

            for (const page of report.pages) {
                for (const problem of page.problems) {
                    assert(report.problems.includes(problem), problem.message);
                }
            }
        });

        it('puts a base template\'s, an unreached partial\'s, and a static asset\'s problems in no page\'s list', async () => {
            const { report } = await compile(makeFiles());
            const listed = report.pages.flatMap(({ problems }) => problems.map(({ filepath }) => filepath));

            assertFalsy(listed.includes('templates/base/default.html'));
            assertFalsy(listed.includes('templates/partials/unused.html'));
            assertFalsy(listed.includes('static-assets/empty.txt'));
        });

        it('gives the same report for the same tree', async () => {
            const first = await compile(makeFiles());
            const second = await compile(makeFiles());

            assertEqual(JSON.stringify(first.report), JSON.stringify(second.report));
            assertEqual(JSON.stringify(first.graph), JSON.stringify(second.graph));
        });
    });

    group('the dependency graph', ({ before, it }) => {
        const visitsRoot = {
            plugin: 'visits',
            pagesDirectory: 'plugins/visits/pages',
            templatesDirectory: 'plugins/visits/templates',
        };
        let graph;
        let result;

        before(async () => {
            result = await compile({
                'pages/page.json': JSON.stringify({ page: { title: 'Home' } }),
                ...makePage('/blog', '{{> nav.html }}{{> teaser }}', {
                    partials: [ { id: 'teaser', filename: 'partials/teaser.html' } ],
                    includes: { intro: { filename: 'intro.md' } },
                }),
                'pages/blog/partials/teaser.html': '{{> byline.html }}',
                'pages/blog/intro.md': '# Blog',
                ...makePage('/blog/2026/first', '<article></article>'),
                'templates/partials/nav.html': '<nav>{{> nav/item.html }}</nav>',
                'templates/partials/nav/item.html': '<a></a>',
                'templates/partials/byline.html': '<p></p>',
                'templates/partials/footer.html': '<footer>{{> nav/item.html }}</footer>',
                'templates/base/default.html': '<html>{{> footer.html }}</html>',
                'static-assets/site.css': 'a { color: red; }',
                'plugins/visits/pages/blog/visits/page.json': JSON.stringify({ template: 'page.html' }),
                'plugins/visits/pages/blog/visits/page.html': '{{> visits/count.html }}',
                'plugins/visits/templates/partials/visits/count.html': '<b></b>',
                'plugins/visits/templates/base/visits.html': '<html></html>',
            }, { pluginContentRoots: [ visitsRoot ] });
            graph = result.graph;
        });

        function findPage(pathname) {
            return graph.pages.find((page) => page.pathname === pathname);
        }

        it('is built from a tree with no problem', () => {
            assertEqual('[]', JSON.stringify(result.report.problems));
        });

        it('lists every page, sorted by pathname, with its owner', () => {
            assertEqual(
                '/ app,/blog app,/blog/2026/first app,/blog/visits visits',
                graph.pages.map(({ pathname, owner }) => `${ pathname } ${ owner }`).join(),
            );
        });

        it('lists a page\'s own template, partial, include, and page.json files', () => {
            assertEqual(JSON.stringify({
                pathname: '/blog',
                owner: 'app',
                metadataFiles: [ 'pages/blog/page.json', 'pages/page.json' ],
                templateFile: 'pages/blog/page.html',
                partialFiles: [ 'pages/blog/partials/teaser.html' ],
                includeFiles: [ 'pages/blog/intro.md' ],
                globalPartials: [ 'byline.html', 'nav.html', 'nav/item.html' ],
            }), JSON.stringify(findPage('/blog')));
        });

        it('lists a page with no template', () => {
            assertEqual(JSON.stringify({
                pathname: '/',
                owner: 'app',
                metadataFiles: [ 'pages/page.json' ],
                templateFile: null,
                partialFiles: [],
                includeFiles: [],
                globalPartials: [],
            }), JSON.stringify(findPage('/')));
        });

        it('lists each ancestor\'s page.json that exists, nearest first, whoever owns it', () => {
            assertEqual(
                'pages/blog/2026/first/page.json,pages/blog/page.json,pages/page.json',
                findPage('/blog/2026/first').metadataFiles.join(),
            );
            assertEqual(
                'plugins/visits/pages/blog/visits/page.json,pages/blog/page.json,pages/page.json',
                findPage('/blog/visits').metadataFiles.join(),
            );
        });

        it('lists every global partial a page reaches, directly, through a page partial, and through another global partial', () => {
            assertEqual('byline.html,nav.html,nav/item.html', findPage('/blog').globalPartials.join());
            assertEqual('visits/count.html', findPage('/blog/visits').globalPartials.join());
            assertEqual('', findPage('/blog/2026/first').globalPartials.join());
        });

        it('lists every global partial, sorted by id, with its owner, file, and direct references', () => {
            assertEqual(JSON.stringify([
                { id: 'byline.html', owner: 'app', file: 'templates/partials/byline.html', partials: [] },
                { id: 'footer.html', owner: 'app', file: 'templates/partials/footer.html', partials: [ 'nav/item.html' ] },
                { id: 'nav.html', owner: 'app', file: 'templates/partials/nav.html', partials: [ 'nav/item.html' ] },
                { id: 'nav/item.html', owner: 'app', file: 'templates/partials/nav/item.html', partials: [] },
                { id: 'visits/count.html', owner: 'visits', file: 'plugins/visits/templates/partials/visits/count.html', partials: [] },
            ], null, 2), JSON.stringify(graph.globalPartials, null, 2));
        });

        it('lists every base template with the global partials it reaches', () => {
            assertEqual(JSON.stringify([
                { id: 'default.html', owner: 'app', file: 'templates/base/default.html', globalPartials: [ 'footer.html', 'nav/item.html' ] },
                { id: 'visits.html', owner: 'visits', file: 'plugins/visits/templates/base/visits.html', globalPartials: [] },
            ], null, 2), JSON.stringify(graph.baseTemplates, null, 2));
        });

        it('links no page to a base template and has no static asset section', () => {
            assertEqual('baseTemplates,globalPartials,pages', Object.keys(graph).sort().join());

            for (const page of graph.pages) {
                assertEqual(
                    'globalPartials,includeFiles,metadataFiles,owner,partialFiles,pathname,templateFile',
                    Object.keys(page).sort().join(),
                );
            }

            assertFalsy(JSON.stringify(graph).includes('site.css'));
            assertFalsy(JSON.stringify(graph.pages).includes('templates/base'));
        });

        it('is plain data', () => {
            assertEqual(JSON.stringify(graph), JSON.stringify(JSON.parse(JSON.stringify(graph))));
        });

        it('does not follow a global partial that a page partial shadows', async () => {
            const shadowed = await compile({
                ...makePage('/', '{{> nav.html }}', { partials: [ { id: 'nav.html', filename: 'nav.html' } ] }),
                'pages/nav.html': '<nav>Mine</nav>',
                'templates/partials/nav.html': '<nav>{{nope a}}</nav>',
            });

            assertEqual('', shadowed.graph.pages[0].globalPartials.join());
            assertEqual('[]', JSON.stringify(shadowed.report.pages));
            assertEqual(1, shadowed.report.problems.length);
        });

        it('is built from what could be read when there are problems', async () => {
            const broken = await compile({
                'pages/page.json': '{ nope',
                ...makePage('/a', '{{#if a}}{{> nav.html }}'),
                ...makePage('/b', '{{> nav.html }}{{nope a}}', { partials: [ { id: 'gone', filename: 'gone.html' } ] }),
                'templates/partials/nav.html': '<nav></nav>',
            });

            assertEqual(null, broken.release);
            assertEqual(JSON.stringify([
                {
                    pathname: '/',
                    owner: 'app',
                    metadataFiles: [ 'pages/page.json' ],
                    templateFile: null,
                    partialFiles: [],
                    includeFiles: [],
                    globalPartials: [],
                },
                {
                    pathname: '/a',
                    owner: 'app',
                    metadataFiles: [ 'pages/a/page.json', 'pages/page.json' ],
                    templateFile: 'pages/a/page.html',
                    partialFiles: [],
                    includeFiles: [],
                    globalPartials: [],
                },
                {
                    pathname: '/b',
                    owner: 'app',
                    metadataFiles: [ 'pages/b/page.json', 'pages/page.json' ],
                    templateFile: 'pages/b/page.html',
                    partialFiles: [],
                    includeFiles: [],
                    globalPartials: [ 'nav.html' ],
                },
            ], null, 2), JSON.stringify(broken.graph.pages, null, 2));
        });
    });
});
