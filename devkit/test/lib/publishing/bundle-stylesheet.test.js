import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { bundleStylesheet } from '../../../lib/publishing/bundle-stylesheet.js';


describe('publishing/bundle-stylesheet', ({ it }) => {
    it('flattens nested imports in cascade order', () => {
        const bundle = makeBundle('/stylesheets/admin.css', {
            '/stylesheets/admin.css': [
                '@import "stylesheet.css";',
                '@import "lib/admin-form.css";',
                '.admin {}',
            ].join('\n'),
            '/stylesheets/stylesheet.css': [
                '@import "lib/reset.css";',
                '@import "/stylesheets/lib/layout.css";',
                '.site {}',
            ].join('\n'),
            '/stylesheets/lib/reset.css': '.reset {}',
            '/stylesheets/lib/layout.css': '.layout {}',
            '/stylesheets/lib/admin-form.css': '.form {}',
        });

        assertEqual([
            '.reset {}',
            '',
            '.layout {}',
            '',
            '.site {}',
            '',
            '.form {}',
            '',
            '.admin {}',
        ].join('\n'), bundle.source);
        assertEqual([
            'static-assets/stylesheets/admin.css',
            'static-assets/stylesheets/stylesheet.css',
            'static-assets/stylesheets/lib/reset.css',
            'static-assets/stylesheets/lib/layout.css',
            'static-assets/stylesheets/lib/admin-form.css',
        ].join('\n'), bundle.sourceFiles.join('\n'));
        assertEqual(0, bundle.problems.length);
    });

    it('resolves nested relative URLs from the containing file', () => {
        const bundle = makeBundle('/styles/main.css', {
            '/styles/main.css': '@import "parts/card.css";',
            '/styles/parts/card.css': '.card { background: url(../images/card.svg?v=1#icon); }',
        });

        assert(bundle.source.includes('url("/styles/images/card.svg?v=1#icon")'));
    });

    it('reports each invalid import resolution case', () => {
        const bundle = makeBundle('/main.css', {
            '/main.css': [
                '@import "x.css?v=1";',
                '@import "x.css#fragment";',
                '@import "../../x.css";',
                '@import "Bad.css";',
                '@import "image.png";',
                '@import "";',
            ].join('\n'),
        });

        assertEqual(6, problemsWithCode(bundle, 'css-import-invalid').length);
    });

    it('reports missing direct and conditioned imports', () => {
        const bundle = makeBundle('/main.css', {
            '/main.css': [
                '@import "missing.css";',
                '@import "themes/print.css" print;',
            ].join('\n'),
        });

        assertEqual(2, problemsWithCode(bundle, 'css-import-missing').length);
        assert(bundle.source.includes('@import "/themes/print.css" print;'));
    });

    it('keeps external imports and rewrites conditioned local imports', () => {
        const source = [
            '@import url("https://example.com/base.css");',
            '@import "themes/print.css" supports(display: grid);',
            'a {}',
        ].join('\n');
        const bundle = makeBundle('/styles/main.css', {
            '/styles/main.css': source,
            '/styles/themes/print.css': '.print {}',
        });

        assert(bundle.source.startsWith('@import url("https://example.com/base.css");'));
        assert(bundle.source.includes([
            '@import "/styles/themes/print.css" supports(display: grid);',
            'a {}',
        ].join('\n')));
        assertEqual('static-assets/styles/main.css', bundle.sourceFiles.join('\n'));
        assertEqual(0, bundle.problems.length);
    });

    it('reports a kept import after flattened content', () => {
        const bundle = makeBundle('/admin.css', {
            '/admin.css': [
                '@import "site.css";',
                '@import "print.css" print;',
            ].join('\n'),
            '/site.css': '.site {}',
            '/print.css': '.print {}',
        });
        const problem = problemsWithCode(bundle, 'css-import-misplaced')[0];

        assert(problem);
        assertEqual('/admin.css', problem.entry);
        assertEqual('/admin.css', problem.importChain.join('\n'));
        assert(problem.message.includes('/admin.css'));
    });

    it('accepts a kept import before flattened content', () => {
        const bundle = makeBundle('/main.css', {
            '/main.css': '@import "print.css" print;\na {}',
            '/print.css': '.print {}',
        });

        assertEqual(0, problemsWithCode(bundle, 'css-import-misplaced').length);
    });

    it('reports direct and indirect cycles with their chains', () => {
        const direct = makeBundle('/a.css', {
            '/a.css': '@import "a.css";',
        });
        const indirect = makeBundle('/a.css', {
            '/a.css': '@import "b.css";',
            '/b.css': '@import "c.css";',
            '/c.css': '@import "a.css";',
        });

        assertEqual(
            '/a.css\n/a.css',
            problemsWithCode(direct, 'css-import-cycle')[0].importChain.join('\n'),
        );
        assertEqual(
            '/a.css\n/b.css\n/c.css\n/a.css',
            problemsWithCode(indirect, 'css-import-cycle')[0].importChain.join('\n'),
        );
    });

    it('includes the entry path before a nested cycle', () => {
        const bundle = makeBundle('/entry.css', {
            '/entry.css': '@import "a.css";',
            '/a.css': '@import "b.css";',
            '/b.css': '@import "a.css";',
        });

        assertEqual(
            '/entry.css\n/a.css\n/b.css\n/a.css',
            problemsWithCode(bundle, 'css-import-cycle')[0].importChain.join('\n'),
        );
    });

    it('inlines diamond dependencies twice and lists sources once', () => {
        const bundle = makeBundle('/entry.css', {
            '/entry.css': '@import "left.css";\n@import "right.css";',
            '/left.css': '@import "shared.css";\n.left {}',
            '/right.css': '@import "shared.css";\n.right {}',
            '/shared.css': '.shared {}',
        });

        assertEqual(2, bundle.source.split('.shared {}').length - 1);
        assertEqual([
            'static-assets/entry.css',
            'static-assets/left.css',
            'static-assets/shared.css',
            'static-assets/right.css',
        ].join('\n'), bundle.sourceFiles.join('\n'));
    });

    it('keeps the entry charset and removes inlined charsets', () => {
        const bundle = makeBundle('/entry.css', {
            '/entry.css': '@charset "UTF-8";\n@import "child.css";\n.entry {}',
            '/child.css': '@charset "utf-8";\n.child {}',
        });

        assertEqual(1, bundle.source.toLowerCase().split('@charset').length - 1);
        assert(bundle.source.startsWith('@charset "UTF-8";'));
        assert(bundle.source.includes('.child {}\n'));
    });

    it('carries file-local problems with their source filepath', () => {
        const bundle = makeBundle('/entry.css', {
            '/entry.css': '@import "child.css";',
            '/child.css': 'a {}\n@import "late.css";',
            '/late.css': 'b {}',
        });
        const problem = problemsWithCode(bundle, 'css-import-misplaced')[0];

        assertEqual('static-assets/child.css', problem.filepath);
        assertEqual(2, problem.line);
        assertEqual(0, problem.column);
        assertEqual(1, problemsWithCode(bundle, 'css-import-misplaced').length);
    });
});

function makeBundle(entryPathname, sources) {
    return bundleStylesheet({
        entryPathname,
        getStylesheet: (pathname) => {
            if (!Object.hasOwn(sources, pathname)) {
                return null;
            }

            return {
                sourcePath: `static-assets${ pathname }`,
                text: sources[pathname],
            };
        },
    });
}

function problemsWithCode(bundle, code) {
    return bundle.problems.filter((problem) => problem.code === code);
}
