import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
} from 'kixx-assert';

import { compileContent } from '../../../kixx/content-compiler/compile-content.js';
import { createMemoryContentSource } from '../../../kixx/content-compiler/memory-content-source.js';
import scanContentSources from '../../../kixx/content-compiler/scan-content-sources.js';


describe('content-compiler/scan-content-sources edge cases', ({ it }) => {
    it('bundles stylesheet entry points and still publishes library files', async () => {
        const source = createMemoryContentSource({
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

        const result = await scanContentSources(source);
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
        const firstSource = createMemoryContentSource({
            'static-assets/styles/main.css': '@import "lib/token.css";\na {}',
            'static-assets/styles/lib/token.css': ':root { --color: red; }',
        });
        const secondSource = createMemoryContentSource({
            'static-assets/styles/main.css': '@import "lib/token.css";\na {}',
            'static-assets/styles/lib/token.css': ':root { --color: blue; }',
        });

        const first = await scanContentSources(firstSource);
        const second = await scanContentSources(secondSource);
        const firstEntry = findResource(first, 'StaticAsset', 'styles/main.css');
        const secondEntry = findResource(second, 'StaticAsset', 'styles/main.css');

        assert(firstEntry.hash !== secondEntry.hash);
    });

    it('deduplicates a library problem reached from several entries', async () => {
        const source = createMemoryContentSource({
            'static-assets/one.css': '@import "lib/shared.css";',
            'static-assets/two.css': '@import "lib/shared.css";',
            'static-assets/lib/shared.css': '@import "missing.css";',
        });

        const result = await scanContentSources(source);
        const problems = result.problems.filter(({ code }) => {
            return code === 'css-import-missing';
        });

        assertEqual(1, problems.length);
        assertEqual('static-assets/lib/shared.css', problems[0].filepath);
        assertEqual(1, problems[0].line);
        assertEqual(0, problems[0].column);
    });

    it('makes stylesheet problems fail publishability', async () => {
        const source = createMemoryContentSource({
            'static-assets/main.css': '@import "missing.css";',
        });
        const result = await compileContent({ source, templateHelpers: [] });

        assertEqual('css-import-missing', result.report.problems[0].code);
        assertEqual(null, result.release);
    });

    it('leaves public stylesheets verbatim', async () => {
        const css = '/* keep */\n@import "relative.css";';
        const source = createMemoryContentSource({
            'public/site.css': css,
        });
        const result = await scanContentSources(source);
        const resource = findResource(result, 'StaticAsset', 'site.css');

        assertEqual(css, decode(resource.payload));
        assertEqual('public/site.css', resource.sourceFiles.join(','));
    });

    it('rejects referenced symlinks which point outside the project', async () => {
        // A source never follows a link, so where it points doesn't matter.
        const source = createMemoryContentSource({
            'pages/page.json': JSON.stringify({ template: 'linked.html' }),
        }, { symlinks: [ 'pages/linked.html' ] });

        const result = await scanContentSources(source);
        const problem = result.problems.find(({ code }) => {
            return code === 'symlink-referenced-file';
        });

        assert(problem, 'expected a symlink validation problem');
        assertEqual('pages/page.json', problem.filepath);
        assertEqual('pages/linked.html', problem.referencedFile);
        assertEqual('pages/linked.html', problem.symlink);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });

    it('rejects symlinked directories in a referenced path', async () => {
        const source = createMemoryContentSource({
            'pages/page.json': JSON.stringify({ template: 'linked/page.html' }),
            'pages/templates/page.html': 'Inside project',
        }, { symlinks: [ 'pages/linked' ] });

        const result = await scanContentSources(source);
        const problem = result.problems.find(({ code }) => {
            return code === 'symlink-referenced-file';
        });

        assert(problem, 'expected a symlink validation problem');
        assertEqual('pages/linked/page.html', problem.referencedFile);
        assertEqual('pages/linked', problem.symlink);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });

    it('rejects an empty page template as a source validation problem', async () => {
        const source = createMemoryContentSource({
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
            'pages/page.html': '',
        });

        const result = await scanContentSources(source);
        const problem = result.problems.find(({ code }) => code === 'empty-page-template');

        assert(problem, 'expected an empty page template problem');
        assertEqual('pages/page.json', problem.filepath);
        assertEqual('pages/page.html', problem.referencedFile);
        assertEqual(false, result.resources.some(({ type }) => type === 'PageTemplate'));
    });

    it('rejects a symlinked source root', async () => {
        const source = createMemoryContentSource({
            'pages/page.json': '{}',
        }, { symlinks: [ 'public' ] });

        const result = await scanContentSources(source);
        const problem = result.problems.find(({ code }) => code === 'symlink-source-root');

        assert(problem, 'expected a symlink source root problem');
        assertEqual('public', problem.filepath);
        assertEqual(false, result.resources.some(({ pathname }) => pathname === 'secret.txt'));
        assertEqual(0, result.unmatchedFiles.length);
    });

    it('rejects a symlinked entry beneath a source root', async () => {
        const source = createMemoryContentSource({
            'pages/page.json': '{}',
            'static-assets/real.txt': 'Real asset',
        }, { symlinks: [ 'static-assets/linked.txt' ] });

        const result = await scanContentSources(source);
        const problem = result.problems.find(({ code }) => code === 'symlink-source-file');

        assert(problem, 'expected a symlink source file problem');
        assertEqual('static-assets/linked.txt', problem.filepath);
        assertEqual(false, result.resources.some(({ pathname }) => pathname === 'linked.txt'));
        assertEqual(0, result.unmatchedFiles.length);
    });

    it('publishes empty page bundles deterministically, and no bundle for an empty template directory', async () => {
        const memorySource = createMemoryContentSource({
            'pages/page.json': '{}',
        });

        // The Node.js source lists an empty directory as a directory with
        // no entries. The in-memory source has no empty directories, and
        // answers "missing". Neither yields a bundle.
        const source = {
            async listFiles(directory) {
                if (directory === 'templates') {
                    return { kind: 'directory', entries: [] };
                }
                return await memorySource.listFiles(directory);
            },
            readFile: memorySource.readFile,
        };

        const first = await scanContentSources(source);
        const second = await scanContentSources(memorySource);

        assertEqual(0, first.problems.length);
        assertEqual(
            'PageIncludes /,PageMetadata /,PagePartials /',
            first.resources.map(({ type, pathname }) => `${ type } ${ pathname }`).join(','),
        );
        assertEqual('[]', JSON.stringify(first.resources[2].payload));
        assertEqual('{}', JSON.stringify(first.resources[0].payload));
        assertEqual(
            first.resources.map(resourceIdentity).join(','),
            second.resources.map(resourceIdentity).join(','),
        );
    });

    it('publishes an empty bundle for a template directory that holds only a symbolic link', async () => {
        const source = createMemoryContentSource({}, {
            symlinks: [ 'templates/partials/linked.html' ],
        });

        const result = await scanContentSources(source);
        const bundle = findResource(result, 'GlobalTemplatePartials', '/');

        assertEqual(0, bundle.payload.length);
        assertEqual('symlink-source-file', result.problems.map(({ code }) => code).join(','));
        assertEqual(false, result.resources.some(({ type }) => type === 'BaseTemplates'));
    });
});

function findResource(result, type, pathname, index = 0) {
    const matches = result.resources.filter((resource) => {
        return resource.type === type && resource.pathname === pathname;
    });

    assert(matches[index], `expected ${ type } at ${ pathname } index ${ index }`);
    return matches[index];
}

function decode(buffer) {
    return new TextDecoder().decode(buffer);
}

function resourceIdentity(resource) {
    return `${ resource.type }:${ resource.pathname }:${ resource.hash }:${ resource.size }`;
}
