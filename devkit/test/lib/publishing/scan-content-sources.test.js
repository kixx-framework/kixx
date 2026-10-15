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
import { assertPublishableContentSources } from '../../../lib/publishing/content-source-report.js';


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
            'emails/welcome/email.json': JSON.stringify({
                htmlTemplate: { id: 'html', filename: 'message.html' },
                textTemplate: { id: 'text', filename: 'message.txt' },
                partials: [
                    { id: 'z-last', filename: 'z-partial.html' },
                    { id: 'a-first', filename: 'a-partial.html' },
                ],
                contextData: { greeting: 'Hello' },
            }),
            'emails/welcome/message.html': '<p>Hello</p>',
            'emails/welcome/message.txt': 'Hello',
            'emails/welcome/a-partial.html': 'A email partial',
            'emails/welcome/z-partial.html': 'Z email partial',
            'emails/welcome/notes.md': 'unmatched email file',
        });

        const result = await scanContentSources(directory);

        assertEqual(0, result.problems.length);
        assertEqual(
            'emails/welcome/notes.md,pages/orphan.html,templates/README.md',
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

        const email = findResource(result, 'EmailAssets', '/welcome');
        assertEqual('Hello', email.payload.contextData.greeting);
        assertEqual(0, Object.keys(email.payload.includes).length);
        assertEqual('html', email.payload.htmlTemplate.id);
        assertEqual('text', email.payload.textTemplate.id);
        assertEqual('a-first,z-last', email.payload.partials.map(({ id }) => id).join(','));
    });

    it('returns all mapping problems as data and keeps unmatched files separate', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': '{ invalid',
            'pages/orphan.txt': 'unmatched',
            'pages/missing/page.json': JSON.stringify({ template: 'absent.html' }),
            'pages/reserved/page.json': JSON.stringify({ template: 'page.json' }),
            'emails/broken/email.json': '[ invalid',
            'emails/extra.txt': 'unmatched',
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

        assertEqual(2, count(codes, 'malformed-json'));
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
            'emails/extra.txt,pages/orphan.txt,templates/README.md',
            result.unmatchedFiles.join(','),
        );
    });

    it('bundles stylesheet entry points and still publishes library files', async () => {
        const directory = await makeProject(directories, {
            'static-assets/stylesheets/stylesheet.css': [
                '@import "lib/reset.css";',
                '@import "/stylesheets/lib/layout.css";',
                '.site { background: url(../images/site.svg); }',
            ].join('\n'),
            'static-assets/stylesheets/admin.css': [
                '@import "stylesheet.css";',
                '@import "lib/admin.css";',
                '.admin {}',
            ].join('\n'),
            'static-assets/stylesheets/lib/reset.css': '.reset {}',
            'static-assets/stylesheets/lib/layout.css': '.layout {}',
            'static-assets/stylesheets/lib/admin.css': '.admin-shell {}',
        });

        const result = await scanContentSources(directory);
        const stylesheet = findResource(
            result,
            'StaticAsset',
            'stylesheets/stylesheet.css',
        );
        const admin = findResource(result, 'StaticAsset', 'stylesheets/admin.css');

        assertEqual(0, result.problems.length);
        assertEqual(false, decode(stylesheet.payload).includes('@import'));
        assertEqual(false, decode(admin.payload).includes('@import'));
        assert(decode(admin.payload).indexOf('.reset {}') <
            decode(admin.payload).indexOf('.site'));
        assert(decode(admin.payload).indexOf('.site') <
            decode(admin.payload).indexOf('.admin-shell'));
        assert(decode(stylesheet.payload).includes('url("/images/site.svg")'));
        assertEqual([
            'static-assets/stylesheets/admin.css',
            'static-assets/stylesheets/stylesheet.css',
            'static-assets/stylesheets/lib/reset.css',
            'static-assets/stylesheets/lib/layout.css',
            'static-assets/stylesheets/lib/admin.css',
        ].join(','), admin.sourceFiles.join(','));
        assert(findResource(
            result,
            'StaticAsset',
            'stylesheets/lib/reset.css',
        ));
    });

    it('changes entry hashes when an imported stylesheet changes', async () => {
        const firstDirectory = await makeProject(directories, {
            'static-assets/styles/main.css': '@import "lib/token.css";\na {}',
            'static-assets/styles/lib/token.css': ':root { --color: red; }',
        });
        const secondDirectory = await makeProject(directories, {
            'static-assets/styles/main.css': '@import "lib/token.css";\na {}',
            'static-assets/styles/lib/token.css': ':root { --color: blue; }',
        });

        const first = await scanContentSources(firstDirectory);
        const second = await scanContentSources(secondDirectory);
        const firstEntry = findResource(first, 'StaticAsset', 'styles/main.css');
        const secondEntry = findResource(second, 'StaticAsset', 'styles/main.css');

        assert(firstEntry.hash !== secondEntry.hash);
    });

    it('deduplicates a library problem reached from several entries', async () => {
        const directory = await makeProject(directories, {
            'static-assets/one.css': '@import "lib/shared.css";',
            'static-assets/two.css': '@import "lib/shared.css";',
            'static-assets/lib/shared.css': '@import "missing.css";',
        });

        const result = await scanContentSources(directory);
        const problems = result.problems.filter(({ code }) => {
            return code === 'css-import-missing';
        });

        assertEqual(1, problems.length);
        assertEqual('static-assets/lib/shared.css', problems[0].filepath);
        assertEqual(1, problems[0].line);
        assertEqual(0, problems[0].column);
    });

    it('makes stylesheet problems fail publishability', async () => {
        const directory = await makeProject(directories, {
            'static-assets/main.css': '@import "missing.css";',
        });
        const result = await scanContentSources(directory);
        const caught = catchError(() => assertPublishableContentSources(result));

        assert(caught, 'expected stylesheet problems to prevent publishing');
        assertMatches('css', result.problems[0].code);
        assertMatches('Nothing was published.', caught.message);
    });

    it('leaves public stylesheets verbatim', async () => {
        const source = '/* keep */\n@import "relative.css";';
        const directory = await makeProject(directories, {
            'public/site.css': source,
        });
        const result = await scanContentSources(directory);
        const resource = findResource(result, 'StaticAsset', 'site.css');

        assertEqual(source, decode(resource.payload));
        assertEqual('public/site.css', resource.sourceFiles.join(','));
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
            'emails/welcome/email.json': JSON.stringify({
                htmlTemplate: { id: '', filename: 'message.html' },
                partials: 'invalid',
            }),
            'emails/welcome/message.html': 'message',
        });

        const result = await scanContentSources(directory);

        assertEqual(6, count(result.problems.map(({ code }) => code), 'invalid-manifest'));
        assert(result.resources.some(({ type }) => type === 'PageMetadata'));
    });

    it('rejects referenced symlinks which point outside the project', async () => {
        const outsideDirectory = await makeProject(directories, {
            'outside.html': 'Outside project',
        });
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({ template: 'linked.html' }),
        });
        await fsp.symlink(
            path.join(outsideDirectory, 'outside.html'),
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

    it('rejects referenced symlinks which point inside the project', async () => {
        const directory = await makeProject(directories, {
            'emails/welcome/email.json': JSON.stringify({
                textTemplate: { id: 'text', filename: 'linked.txt' },
            }),
            'emails/welcome/message.txt': 'Inside project',
        });
        await fsp.symlink(
            path.join(directory, 'emails', 'welcome', 'message.txt'),
            path.join(directory, 'emails', 'welcome', 'linked.txt'),
        );

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => {
            return code === 'symlink-referenced-file';
        });

        assert(problem, 'expected a symlink validation problem');
        assertEqual('emails/welcome/linked.txt', problem.referencedFile);
        assertEqual('emails/welcome/linked.txt', problem.symlink);
        const email = findResource(result, 'EmailAssets', '/welcome');
        assertEqual(undefined, email.payload.textTemplate);
    });

    it('rejects symlinked directories in a referenced path', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({ template: 'linked/page.html' }),
            'pages/templates/page.html': 'Inside project',
        });
        await fsp.symlink(
            path.join(directory, 'pages', 'templates'),
            path.join(directory, 'pages', 'linked'),
        );

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => {
            return code === 'symlink-referenced-file';
        });

        assert(problem, 'expected a symlink validation problem');
        assertEqual('pages/linked/page.html', problem.referencedFile);
        assertEqual('pages/linked', problem.symlink);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });

    it('rejects an empty page template as a source validation problem', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
            'pages/page.html': '',
        });

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => code === 'empty-page-template');

        assert(problem, 'expected an empty page template problem');
        assertEqual('pages/page.json', problem.filepath);
        assertEqual('pages/page.html', problem.referencedFile);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });

    it('rejects a symlinked source root', async () => {
        const outsideDirectory = await makeProject(directories, {
            'secret.txt': 'Outside project',
        });
        const directory = await makeProject(directories, {
            'pages/page.json': '{}',
        });
        await fsp.rm(path.join(directory, 'public'), { recursive: true, force: true });
        await fsp.symlink(outsideDirectory, path.join(directory, 'public'));

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => code === 'symlink-source-root');

        assert(problem, 'expected a symlink source root problem');
        assertEqual('public', problem.filepath);
        assertEqual(false, result.resources.some(({ pathname }) => pathname === 'secret.txt'));
        assertEqual(0, result.unmatchedFiles.length);
    });

    it('rejects a symlinked entry beneath a source root', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': '{}',
            'static-assets/real.txt': 'Real asset',
        });
        await fsp.symlink(
            path.join(directory, 'static-assets', 'real.txt'),
            path.join(directory, 'static-assets', 'linked.txt'),
        );

        const result = await scanContentSources(directory);
        const problem = result.problems.find(({ code }) => code === 'symlink-source-file');

        assert(problem, 'expected a symlink source file problem');
        assertEqual('static-assets/linked.txt', problem.filepath);
        assertEqual(false, result.resources.some(({ pathname }) => pathname === 'linked.txt'));
        assertEqual(0, result.unmatchedFiles.length);
    });

    it('publishes empty page and existing template bundles deterministically', async () => {
        const directory = await makeProject(directories, {
            'pages/page.json': '{}',
        });
        await fsp.mkdir(path.join(directory, 'templates', 'partials'), { recursive: true });
        await fsp.mkdir(path.join(directory, 'templates', 'base'), { recursive: true });

        const first = await scanContentSources(directory);
        const second = await scanContentSources(directory);

        assertEqual(5, first.resources.length);
        assertEqual(
            first.resources.map(resourceIdentity).join(','),
            second.resources.map(resourceIdentity).join(','),
        );
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

function resourceIdentity(resource) {
    return `${ resource.type }:${ resource.pathname }:${ resource.hash }:${ resource.size }`;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }

    return null;
}
