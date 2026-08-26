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

function makeScanner(root, fileSystem) {
    return new DeveloperSourceScanner({
        pagesDirectory: path.join(root, 'pages'),
        templatesDirectory: path.join(root, 'templates'),
        staticAssetsDirectory: path.join(root, 'static-assets'),
        emailsDirectory: path.join(root, 'emails'),
        fileSystem,
    });
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
            'pages/page.json': JSON.stringify({ template: 'default.html', partials: [ { id: 'root.html', filename: 'root.html' } ] }),
            'pages/admin/page.json': JSON.stringify({}),
            'pages/admin/style-guide/page.json': JSON.stringify({ template: 'style/style-guide-wrapper.html', partials: [ { id: 'style.html', filename: 'style/partial.html' } ] }),
            'pages/admin/style-guide/copy-fields/page.json': JSON.stringify({
                template: 'copy-fields.html',
                partials: [
                    { id: 'label.html', filename: 'label.html' },
                    { id: 'copy-field.html', filename: 'copy-field.html' },
                ],
                includes: { body: { filename: 'body.html' } },
            }),
            'pages/admin/style-guide/copy-fields/body.html': 'Copy fields',
            'templates/pages/default.html': 'Default',
            'templates/pages/root.html': 'Root partial',
            'templates/pages/style/style-guide-wrapper.html': 'Style guide',
            'templates/pages/style/partial.html': 'Style partial',
            'templates/pages/copy-fields.html': 'Copy fields page',
            'templates/pages/copy-field.html': 'Copy field partial',
            'templates/pages/label.html': 'Label partial',
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
            const template = manifest.get('/pages/admin/style-guide/copy-fields/copy-fields.html');
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
            'pages/page.json': JSON.stringify({ template: 'default.html', partials: [ { id: 'root.html', filename: 'root.html' } ] }),
            'pages/admin/page.json': JSON.stringify({}),
            'templates/pages/default.html': 'Default',
            'templates/pages/root.html': 'Root partial',
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
            'templates/pages/__page-includes-bundle': 'collision',
        });

        try {
            const caught = await catchAsyncError(() => makeScanner(root).scan());

            assertEqual('AssertionError', caught.name);
            assertMatches('reserved filename', caught.message);
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
});
