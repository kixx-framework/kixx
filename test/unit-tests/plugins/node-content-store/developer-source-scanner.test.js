import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertMatches,
} from 'kixx-assert';

import DeveloperSourceScanner from '../../../../src/plugins/node-content-store/lib/developer-source-scanner.js';


async function makeWorkspace(files = {}) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-developer-scanner-'));
    for (const [ relativePath, source ] of Object.entries(files)) {
        const filepath = path.join(root, relativePath);
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, source);
    }
    return root;
}

function makeScanner(root, fileSystem, options = {}) {
    return new DeveloperSourceScanner({
        pagesDirectory: path.join(root, 'pages'),
        templatesDirectory: path.join(root, 'templates'),
        staticAssetsDirectory: path.join(root, 'static-assets'),
        emailsDirectory: path.join(root, 'emails'),
        fileSystem,
        ...options,
    });
}

function makeIsolatingScanner(root) {
    return makeScanner(root, undefined, { isolatePageErrors: true });
}

function pageKeys(manifest, prefix) {
    return [ ...manifest.keys() ].filter((pathname) => pathname.startsWith(prefix)).join(',');
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('DeveloperSourceScanner', ({ it }) => {
    it('maps pages, leaf directives, templates, and assets to storage pathnames', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html', partials: [ { id: 'root.html', filename: 'root.html' } ] }),
            'pages/page.html': 'Default',
            'pages/root.html': 'Root partial',
            'pages/admin/page.json': JSON.stringify({}),
            'pages/admin/style-guide/page.json': JSON.stringify({ template: 'page.html', partials: [ { id: 'style.html', filename: 'style.html' } ] }),
            'pages/admin/style-guide/page.html': 'Style guide',
            'pages/admin/style-guide/style.html': 'Style partial',
            'pages/admin/style-guide/copy-fields/page.json': JSON.stringify({
                template: 'page.html',
                partials: [
                    { id: 'label.html', filename: 'label.html' },
                    { id: 'copy-field.html', filename: 'copy-field.html' },
                ],
                includes: { body: { filename: 'body.html' } },
            }),
            'pages/admin/style-guide/copy-fields/body.html': 'Copy fields',
            'pages/admin/style-guide/copy-fields/page.html': 'Copy fields page',
            'pages/admin/style-guide/copy-fields/copy-field.html': 'Copy field partial',
            'pages/admin/style-guide/copy-fields/label.html': 'Label partial',
            'templates/partials/common/site.html': 'Common partial',
            'templates/base/default.html': 'Base template',
            'static-assets/images/logo.svg': '<svg></svg>',
            'static-assets/stylesheets/stylesheet.css': 'Stylesheet',
            'static-assets/stylesheets/admin.css': 'Admin stylesheet',
            'static-assets/javascript/site.js': 'Site JavaScript',
            'emails/welcome/email.json': JSON.stringify({
                htmlTemplate: { id: 'welcome.html', filename: 'message.html' },
                partials: [
                    { id: 'signature.html', filename: 'signature.html' },
                    { id: 'legal.html', filename: 'legal.html' },
                ],
            }),
            'emails/welcome/message.html': 'Welcome',
            'emails/welcome/signature.html': 'Signature',
            'emails/welcome/legal.html': 'Legal',
        });

        try {
            const manifest = await makeScanner(root).scan();
            const keys = [ ...manifest.keys() ];
            const template = manifest.get('/pages/admin/style-guide/copy-fields/page.html');
            const partials = manifest.get('/pages/admin/style-guide/copy-fields/__page-partials-bundle');
            const email = manifest.get('/emails/welcome/__email-assets');

            assert(template, 'expected leaf template recipe');
            assertEqual(1, template.manifests.length);
            assertEqual('copy-field.html,label.html', partials.sources.map(({ id }) => id).join(','));
            assert(manifest.has('/templates/__template-partials-bundle'));
            assert(manifest.has('/templates/__base-templates-bundle'));
            assert(manifest.has('/assets/images/logo.svg'));
            assert(manifest.has('/assets/stylesheets/stylesheet.css'));
            assert(manifest.has('/assets/stylesheets/admin.css'));
            assert(manifest.has('/assets/javascript/site.js'));
            assertEqual('htmlTemplate,partial,partial', email.sources.map(({ role }) => role).join(','));
            assertEqual('welcome.html,legal.html,signature.html', email.sources.map(({ id }) => id).join(','));
            assertFalsy(manifest.has('/pages/admin/style-guide/copy-fields/body.html'));
            assertEqual(keys.slice().sort().join('\n'), keys.join('\n'));
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('does not inherit build directives from ancestor page metadata', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html', partials: [ { id: 'root.html', filename: 'root.html' } ] }),
            'pages/page.html': 'Default',
            'pages/root.html': 'Root partial',
            'pages/admin/page.json': JSON.stringify({}),
        });

        try {
            const manifest = await makeScanner(root).scan();
            const adminKeys = [ ...manifest.keys() ].filter((pathname) => pathname.startsWith('/pages/admin/'));

            assertEqual(
                '/pages/admin/__page-includes-bundle,/pages/admin/__page-partials-bundle,/pages/admin/page.json',
                adminKeys.join(','),
            );
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('treats missing optional source roots as empty', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({}),
        });

        try {
            const manifest = await makeScanner(root).scan();

            assertEqual(3, manifest.size);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('rejects source filenames which cannot become canonical pathnames', async () => {
        const root = await makeWorkspace({ 'static-assets/Bad Name.txt': 'invalid' });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('ValidationError', caught.name);
            assertMatches('Bad Name.txt', caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('rejects malformed page metadata with the source filepath', async () => {
        const root = await makeWorkspace({ 'pages/page.json': '{ nope' });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('ValidationError', caught.name);
            assertMatches(path.join(root, 'pages/page.json'), caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('rejects duplicate partial ids in source manifests', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({
                partials: [
                    { id: 'card.html', filename: 'card.html' },
                    { id: 'card.html', filename: 'other-card.html' },
                ],
            }),
        });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('ValidationError', caught.name);
            assertMatches('duplicate id "card.html"', caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('asserts when a template basename collides with a reserved page filename', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: '__page-includes-bundle' }),
            'pages/__page-includes-bundle': 'collision',
        });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('AssertionError', caught.name);
            assertMatches('reserved filename', caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('attaches a manifest facet to every recipe kind', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html', partials: [ { id: 'root.html', filename: 'root.html' } ] }),
            'pages/page.html': 'Default',
            'pages/root.html': 'Root partial',
            'templates/partials/common/site.html': 'Common partial',
            'templates/base/default.html': 'Base template',
            'static-assets/images/logo.svg': '<svg></svg>',
            'emails/welcome/email.json': JSON.stringify({
                htmlTemplate: { id: 'welcome.html', filename: 'message.html' },
            }),
            'emails/welcome/message.html': 'Welcome',
        });

        try {
            const manifest = await makeScanner(root).scan();

            assertEqual(
                JSON.stringify({ name: 'page', pathname: '/', field: 'metadata' }),
                JSON.stringify(manifest.get('/pages/page.json').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'page', pathname: '/', field: 'templates', filename: 'page.html' }),
                JSON.stringify(manifest.get('/pages/page.html').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'page', pathname: '/', field: 'partials' }),
                JSON.stringify(manifest.get('/pages/__page-partials-bundle').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'page', pathname: '/', field: 'includes' }),
                JSON.stringify(manifest.get('/pages/__page-includes-bundle').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'globalTemplatePartials' }),
                JSON.stringify(manifest.get('/templates/__template-partials-bundle').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'baseTemplates' }),
                JSON.stringify(manifest.get('/templates/__base-templates-bundle').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'staticAssets', pathname: '/images/logo.svg' }),
                JSON.stringify(manifest.get('/assets/images/logo.svg').facet),
            );
            assertEqual(
                JSON.stringify({ name: 'emails', pathname: '/welcome' }),
                JSON.stringify(manifest.get('/emails/welcome/__email-assets').facet),
            );
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('does not re-read unchanged manifest JSON on repeat scans', async () => {
        const root = await makeWorkspace({ 'pages/page.json': JSON.stringify({}) });
        let readCount = 0;
        const fileSystem = {
            ...fsp,
            async readFile(...args) {
                readCount += 1;
                return await fsp.readFile(...args);
            },
        };

        try {
            const scanner = makeScanner(root, fileSystem);
            await scanner.scan();
            await scanner.scan();

            assertEqual(1, readCount);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('rejects a missing referenced page file by default', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({ template: 'page.html' }),
        });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('ValidationError', caught.name);
            assertMatches(path.join(root, 'pages/page.html'), caught.message);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('records a page with a missing referenced file as an error recipe when isolating', async () => {
        const cases = [
            [ 'template', { template: 'page.html' }, 'page.html' ],
            [ 'partial', { partials: [ { id: 'card.html', filename: 'card.html' } ] }, 'card.html' ],
            [ 'include', { includes: { body: { filename: 'body.html' } } }, 'body.html' ],
        ];

        for (const [ label, json, missingFilename ] of cases) {
            const root = await makeWorkspace({
                'pages/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/page.html': 'Home',
                'pages/broken/page.json': JSON.stringify(json),
                'pages/broken/child/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/broken/child/page.html': 'Child',
            });

            try {
                const manifest = await makeIsolatingScanner(root).scan();
                const metadata = manifest.get('/pages/broken/page.json');
                const recipe = manifest.get('/pages/broken/__page-partials-bundle');

                assertEqual('file', metadata.kind, label);
                assertEqual('error', recipe.kind, label);
                assertEqual('ValidationError', recipe.error.name, label);
                assertMatches(path.join(root, 'pages/broken', missingFilename), recipe.error.message);
                assertEqual(0, recipe.sources.length, label);
                assertEqual(path.join(root, 'pages/broken/page.json'), recipe.manifests[0].filepath, label);
                assertEqual(
                    JSON.stringify({ name: 'page', pathname: '/broken', field: 'partials' }),
                    JSON.stringify(recipe.facet),
                );
                assertFalsy(manifest.has('/pages/broken/page.html'), label);
                assertFalsy(manifest.has('/pages/broken/__page-includes-bundle'), label);
                assert(manifest.has('/pages/page.html'), label);
                assert(manifest.has('/pages/broken/child/page.html'), label);
            } finally {
                await fsp.rm(root, { recursive: true, force: true });
            }
        }
    });

    it('records invalid page metadata as an error recipe when isolating', async () => {
        const cases = [
            [ 'malformed JSON', '{ nope', 'malformed JSON' ],
            [ 'invalid shape', JSON.stringify({ template: 42 }), 'template must be a string' ],
        ];

        for (const [ label, source, message ] of cases) {
            const root = await makeWorkspace({
                'pages/page.json': JSON.stringify({ template: 'page.html' }),
                'pages/page.html': 'Home',
                'pages/broken/page.json': source,
                'pages/broken/page.html': 'Broken',
            });

            try {
                const manifest = await makeIsolatingScanner(root).scan();
                const recipe = manifest.get('/pages/broken/page.json');

                assertEqual('error', recipe.kind, label);
                assertEqual('ValidationError', recipe.error.name, label);
                assertMatches(message, recipe.error.message);
                assertEqual(
                    JSON.stringify({ name: 'page', pathname: '/broken', field: 'metadata' }),
                    JSON.stringify(recipe.facet),
                );
                assertEqual('/pages/broken/page.json', pageKeys(manifest, '/pages/broken/'), label);
                assert(manifest.has('/pages/page.html'), label);
            } finally {
                await fsp.rm(root, { recursive: true, force: true });
            }
        }
    });

    it('still fails the whole scan for errors it cannot attribute to a page when isolating', async () => {
        const cases = [
            [ 'pages/Bad Dir/page.json', JSON.stringify({}), 'ValidationError' ],
            [ 'static-assets/Bad Name.txt', 'invalid', 'ValidationError' ],
        ];

        for (const [ relativePath, source, name ] of cases) {
            const root = await makeWorkspace({ [relativePath]: source });

            try {
                const caught = await catchAsyncError(() => makeIsolatingScanner(root).scan());

                assertEqual(name, caught.name, relativePath);
            } finally {
                await fsp.rm(root, { recursive: true, force: true });
            }
        }
    });
});
