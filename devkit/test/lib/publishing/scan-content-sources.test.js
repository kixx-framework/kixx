import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
} from '../../../lib/vendor/kixx-assert/mod.js';

import scanContentSources from '../../../lib/publishing/scan-content-sources.js';


describe('publishing/scan-content-sources', ({ after, it }) => {
    const directories = [];

    after(async () => {
        await Promise.all(directories.map((directory) => {
            return fsp.rm(directory, { recursive: true, force: true });
        }));
    });

    it('materializes every content convention into deterministic resources', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({
                template: 'nested/page.html',
                partials: [
                    { id: 'z-last', filename: 'z.html' },
                    { id: 'a-first', filename: 'a.html' },
                ],
                includes: {
                    zeta: { filename: 'z-include.html' },
                    alpha: { filename: 'a-include.html' },
                },
                page: { title: 'Home' },
            }),
            'pages/nested/page.html': '<main>Home</main>',
            'pages/a.html': 'A partial',
            'pages/z.html': 'Z partial',
            'pages/a-include.html': 'A include',
            'pages/z-include.html': 'Z include',
            'pages/orphan.html': 'unmatched page file',
            'pages/blog/page.json': JSON.stringify({ template: '' }),
            'templates/partials/z.html': 'Z global',
            'templates/partials/nested/a.html': 'A global',
            'templates/base/default.html': '<html>{{ content }}</html>',
            'templates/README.md': 'unmatched template file',
            'static-assets/app.js': 'const text = "// literal"; // removed\nconst regex = /\\/\\*/;',
            'static-assets/site.css': 'a { content: "/* literal */"; } /* removed */',
            'static-assets/image.bin': Uint8Array.from([ 0, 127, 255 ]),
            'public/public-app.js': '// public comments stay\nconst publicFile = true;',
            'public/favicon.ico': Uint8Array.from([ 1, 2, 3 ]),
        });

        const result = await scanContentSources(directory);

        assertEqual(0, result.problems.length);
        assertEqual(
            'pages/orphan.html,templates/README.md',
            result.unmatchedFiles.join(','),
        );

        const metadata = findResource(result, 'PageMetadata', '/');
        assertEqual('Home', metadata.payload.page.title);
        assertResourceAddress(metadata);

        const template = findResource(result, 'PageTemplate', '/page.html');
        assertEqual('<main>Home</main>', template.payload);
        assertResourceAddress(template);

        const partials = findResource(result, 'PagePartials', '/');
        assertEqual('a-first,z-last', partials.payload.map(({ id }) => id).join(','));
        assertEqual('A partial', partials.payload[0].source);

        const includes = findResource(result, 'PageIncludes', '/');
        assertEqual('alpha,zeta', Object.keys(includes.payload).join(','));
        assertEqual('A include', includes.payload.alpha);

        const emptyPartials = findResource(result, 'PagePartials', '/blog');
        const emptyIncludes = findResource(result, 'PageIncludes', '/blog');
        assertEqual(0, emptyPartials.payload.length);
        assertEqual(0, Object.keys(emptyIncludes.payload).length);

        const globalPartials = findResource(result, 'GlobalTemplatePartials', '/');
        assertEqual(
            'nested/a.html,z.html',
            globalPartials.payload.map(({ id }) => id).join(','),
        );

        const baseTemplates = findResource(result, 'BaseTemplates', '/');
        assertEqual('default.html', baseTemplates.payload[0].id);

        const javaScript = findResource(result, 'StaticAsset', 'app.js');
        assertEqual(
            'const text = "// literal";  \nconst regex = /\\/\\*/;',
            decode(javaScript.payload),
        );

        const css = findResource(result, 'StaticAsset', 'site.css');
        assertEqual('a { content: "/* literal */"; } ', decode(css.payload));

        const publicJavaScript = findResource(result, 'StaticAsset', 'public-app.js');
        assertEqual('// public comments stay\nconst publicFile = true;', decode(publicJavaScript.payload));

        const binary = findResource(result, 'StaticAsset', 'image.bin');
        assertEqual('0,127,255', new Uint8Array(binary.payload).join(','));

        assertEqual(
            'BaseTemplates,GlobalTemplatePartials,PageIncludes,PageMetadata,PagePartials,PageTemplate,StaticAsset',
            [ ...new Set(result.resources.map(({ type }) => type)) ].sort().join(','),
        );
    });

    it('returns all mapping problems as data and keeps unmatched files separate', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': '{ invalid',
            'pages/orphan.txt': 'unmatched',
            'pages/missing/page.json': JSON.stringify({ template: 'absent.html' }),
            'pages/reserved/page.json': JSON.stringify({ template: 'page.json' }),
            'templates/README.md': 'unmatched',
            'static-assets/Bad Name.txt': 'invalid pathname',
            'static-assets/empty.txt': '',
            'static-assets/comments-only.css': '/* removed to empty */',
            'static-assets/bad.js': 'const = 1;',
            'static-assets/shared.txt': 'static version',
            'public/shared.txt': 'public version',
        });

        const result = await scanContentSources(directory);
        const codes = result.problems.map(({ code }) => code);

        assertEqual(1, count(codes, 'malformed-json'));
        assertEqual(1, count(codes, 'missing-referenced-file'));
        assertEqual(1, count(codes, 'reserved-template-filename'));
        assertEqual(1, count(codes, 'invalid-pathname'));
        assertEqual(2, count(codes, 'empty-static-asset'));
        assertEqual(1, count(codes, 'invalid-javascript'));
        assertEqual(1, count(codes, 'static-asset-collision'));

        const javaScriptProblem = result.problems.find(({ code }) => code === 'invalid-javascript');
        assertEqual('static-assets/bad.js', javaScriptProblem.filepath);
        assertEqual(1, javaScriptProblem.line);

        assertEqual(
            'pages/orphan.txt,templates/README.md',
            result.unmatchedFiles.join(','),
        );
    });

    it('returns manifest shape problems without throwing', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({
                template: 42,
                partials: [
                    { id: '', filename: 'partial.html' },
                    { id: 'same', filename: 'partial.html' },
                    { id: 'same', filename: 'partial.html' },
                ],
                includes: [],
            }),
            'pages/partial.html': 'partial',
        });

        const result = await scanContentSources(directory);

        assertEqual(4, count(result.problems.map(({ code }) => code), 'invalid-manifest'));
        assert(result.resources.some(({ type }) => type === 'PageMetadata'));
    });

    it('rejects referenced symlinks which point inside the project', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({ template: 'linked.html' }),
            'pages/real.html': 'Inside project',
        });
        await fsp.symlink(
            path.join(directory, 'pages', 'real.html'),
            path.join(directory, 'pages', 'linked.html'),
        );

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => {
            return code === 'symlink-referenced-file';
        });

        assert(problem, 'expected a symlink validation problem');
        assertEqual('pages/page.json', problem.filepath);
        assertEqual('pages/linked.html', problem.referencedFile);
        assertEqual('pages/linked.html', problem.symlink);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });
});

async function makeProject(directories, files) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-publishing-'));
    directories.push(directory);

    for (const [ relativePath, contents ] of Object.entries(files)) {
        const filepath = path.join(directory, relativePath);
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, contents);
    }

    return directory;
}

function findResource(result, type, pathname, index = 0) {
    const matches = result.resources.filter((resource) => {
        return resource.type === type && resource.pathname === pathname;
    });

    assert(matches[index], `expected ${ type } at ${ pathname } index ${ index }`);
    return matches[index];
}

function assertResourceAddress(resource) {
    assertMatches(/^[a-z2-7]{26}$/, resource.hash);
    assert(resource.size > 0);
    assert(resource.sourceFiles.length > 0);
}

function decode(buffer) {
    return new TextDecoder().decode(buffer);
}

function count(values, expected) {
    return values.filter((value) => value === expected).length;
}
