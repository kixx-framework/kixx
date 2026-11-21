import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import {
    parseStylesheet,
    renderStylesheet,
} from '../../../lib/publishing/parse-stylesheet.js';


describe('publishing/parse-stylesheet', ({ it }) => {
    it('recognizes supported import forms case-insensitively', () => {
        const source = [
            '@import "one.css";',
            "@IMPORT 'two.css';",
            '@import url(three.css);',
            '@import URL("four.css");',
        ].join('\n');
        const parsed = parseStylesheet(source);

        assertEqual(4, parsed.imports.length);
        assertEqual('one.css', parsed.imports[0].specifier);
        assertEqual('string', parsed.imports[0].form);
        assertEqual('"', parsed.imports[0].quote);
        assertEqual(1, parsed.imports[0].line);
        assertEqual(0, parsed.imports[0].column);
        assertEqual('two.css', parsed.imports[1].specifier);
        assertEqual('three.css', parsed.imports[2].specifier);
        assertEqual('url', parsed.imports[2].form);
        assertEqual(null, parsed.imports[2].quote);
        assertEqual('four.css', parsed.imports[3].specifier);
        assertEqual('"', parsed.imports[3].quote);
    });

    it('ignores import-like text in comments strings and URLs', () => {
        const source = [
            '/* @import "comment.css"; */',
            'a::before { content: "@import \'string.css\';"; }',
            'a { background: url("@import.css"); }',
        ].join('\n');

        assertEqual(0, parseStylesheet(source).imports.length);
    });

    it('classifies conditioned and external imports', () => {
        const parsed = parseStylesheet([
            '@import "screen.css" screen;',
            '@import url("supports.css") supports(display: grid);',
            '@import "layer.css" layer(theme);',
            '@import "https://example.com/external.css";',
        ].join('\n'));

        assert(parsed.imports[0].isConditioned);
        assertEqual('screen', parsed.imports[0].condition);
        assert(parsed.imports[1].isConditioned);
        assert(parsed.imports[2].isConditioned);
        assertEqual('external', parsed.imports[3].kind);
    });

    it('treats comments as whitespace and requires import whitespace', () => {
        const parsed = parseStylesheet([
            '@import /* gap */ "plain.css" /* trailing */;',
            '@import"invalid.css";',
        ].join('\n'));

        assertEqual(1, parsed.imports.length);
        assertEqual('/* trailing */', parsed.imports[0].condition);
        assertEqual(false, parsed.imports[0].isConditioned);
        assertProblem(parsed, 'css-import-invalid', 2, 0);
    });

    it('reports malformed and misplaced imports at original positions', () => {
        const parsed = parseStylesheet([
            'a {}',
            '  @import "late.css";',
            '@import;',
            'b { @import "nested.css"; }',
        ].join('\n'));

        assertProblem(parsed, 'css-import-misplaced', 2, 2);
        assertProblem(parsed, 'css-import-invalid', 3, 0);
        assertProblem(parsed, 'css-import-misplaced', 4, 4);
    });

    it('accepts only a leading UTF-8 charset', () => {
        const accepted = parseStylesheet('@charset "UTF-8";\na {}');
        const unsupported = parseStylesheet('@charset "iso-8859-1";');
        const late = parseStylesheet('\n@charset "utf-8";');

        assertEqual('UTF-8', accepted.charset.value);
        assertEqual(0, accepted.problems.length);
        assertProblem(unsupported, 'css-charset-unsupported', 1, 0);
        assertProblem(late, 'css-charset-unsupported', 2, 0);
    });

    it('rewrites relative URLs and preserves other URL classes', () => {
        const source = [
            'a { background: url(../images/a.svg?v=1#icon); }',
            'b { src: url("/fonts/b.woff2"); }',
            'c { src: url(data:font/woff2;base64,AA); }',
            'd { src: url(#glyph); }',
            'e { src: url(); }',
        ].join('\n');
        const parsed = parseStylesheet(source);
        const rendered = renderStylesheet({
            source,
            parsed,
            pathname: '/stylesheets/main.css',
            replaceImport: () => '',
        });

        assert(rendered.includes('url("/images/a.svg?v=1#icon")'));
        assert(rendered.includes('url("/fonts/b.woff2")'));
        assert(rendered.includes('url(data:font/woff2;base64,AA)'));
        assert(rendered.includes('url(#glyph)'));
        assert(rendered.includes('url()'));
    });

    it('does not recognize URL functions inside longer identifiers', () => {
        const source = 'a { value: myurl(icon.svg); }';
        const parsed = parseStylesheet(source);

        assertEqual(0, parsed.urls.length);
        assertEqual(source, renderStylesheet({
            source,
            parsed,
            pathname: '/main.css',
            replaceImport: () => '',
        }));
    });

    it('reports relative bare image-set strings', () => {
        const parsed = parseStylesheet([
            'a { image: image-set("small.png" 1x, url(large.png) 2x); }',
            'b { image: -webkit-image-set("/small.png" 1x); }',
        ].join('\n'));

        assertProblem(parsed, 'css-url-invalid', 1, 21);
        assertEqual(1, parsed.problems.length);
        assertEqual('relative', parsed.urls[0].kind);
    });

    it('replaces imports and strips comments while rendering', () => {
        const source = '/* first */@import "x.css";/* second */a {}';
        const parsed = parseStylesheet(source);
        const rendered = renderStylesheet({
            source,
            parsed,
            pathname: '/main.css',
            replaceImport: (statement) => `/* ${statement.specifier} */\nb {}`,
        });

        assertEqual('/* x.css */\nb {}a {}', rendered);
    });

    it('treats layer statements as insignificant and strips their comments', () => {
        const source = '@layer reset, /* theme order */ theme;\n@import "x.css";';
        const parsed = parseStylesheet(source);
        const rendered = renderStylesheet({
            source,
            parsed,
            pathname: '/main.css',
            replaceImport: () => '',
        });

        assertEqual(0, parsed.problems.length);
        assertEqual('@layer reset,  theme;\n', rendered);
    });

    it('matches existing CSS comment stripping for stable sources', () => {
        const fixtures = [
            {
                source: '/* first */a { color: red; /* second */ display: block; }',
                expected: 'a { color: red;  display: block; }',
            },
            {
                source: [
                'a::before { content: "/* text */"; }',
                'a { background: url(images/*literal*/icon.svg); }',
                "b { background: URL('data:image/svg+xml;/*literal*/'); }",
                '/* removed */',
                ].join('\n'),
                expected: [
                    'a::before { content: "/* text */"; }',
                    'a { background: url(images/*literal*/icon.svg); }',
                    "b { background: URL('data:image/svg+xml;/*literal*/'); }",
                    '',
                ].join('\n'),
            },
        ];

        for (const fixture of fixtures) {
            const rendered = renderStylesheet({
                source: fixture.source,
                parsed: parseStylesheet(fixture.source),
                pathname: '/main.css',
                replaceImport: () => '',
            });

            assertEqual(fixture.expected, rendered);
        }
    });
});

function assertProblem(parsed, code, line, column) {
    const problem = parsed.problems.find((candidate) => candidate.code === code &&
        candidate.line === line && candidate.column === column);

    assert(problem, `expected ${code} at ${line}:${column}`);
}
