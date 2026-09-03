import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import DeveloperSourceScanner from '../../../../src/plugins/node-content-store/lib/developer-source-scanner.js';
import { buildReleaseManifest } from '../../../../src/plugins/node-content-store/lib/release-manifest-builder.js';
import { getDeveloperBlob } from '../../../../src/plugins/node-content-store/lib/developer-blobs.js';
import { validateReleaseManifest } from '../../../../src/kixx/content-addressable-store/release-manifest.js';
import { hashBlob } from '../../../../src/kixx/content-addressable-store/addressing.js';


async function makeWorkspace(files) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-release-manifest-builder-'));
    for (const [ relativePath, source ] of Object.entries(files)) {
        const filepath = path.join(root, relativePath);
        await fsp.mkdir(path.dirname(filepath), { recursive: true });
        await fsp.writeFile(filepath, source);
    }
    return root;
}

function makeScanner(root) {
    return new DeveloperSourceScanner({
        pagesDirectory: path.join(root, 'pages'),
        templatesDirectory: path.join(root, 'templates'),
        staticAssetsDirectory: path.join(root, 'static-assets'),
        emailsDirectory: path.join(root, 'emails'),
    });
}

function makeRecordingPutObject(calls) {
    return async function putObject(bytes, pathname) {
        calls.push({ pathname, bytes });
        const objectId = await hashBlob(bytes);
        return { objectId, size: bytes.byteLength };
    };
}

const FIXTURE_FILES = {
    'pages/page.json': JSON.stringify({
        template: 'page.html',
        partials: [ { id: 'root.html', filename: 'root.html' } ],
        includes: { body: { filename: 'body.html' } },
    }),
    'pages/page.html': 'Default page template',
    'pages/root.html': 'Root partial',
    'pages/body.html': 'Body include',
    'templates/partials/common/site.html': 'Common partial',
    'templates/base/default.html': 'Base template',
    'static-assets/images/logo.svg': '<svg></svg>',
    'emails/welcome/email.json': JSON.stringify({
        htmlTemplate: { id: 'welcome.html', filename: 'message.html' },
    }),
    'emails/welcome/message.html': 'Welcome email',
};


describe('buildReleaseManifest', ({ it }) => {

    it('builds a manifest that validateReleaseManifest accepts', async () => {
        const root = await makeWorkspace(FIXTURE_FILES);

        try {
            const scanner = makeScanner(root);
            const calls = [];
            const manifest = await buildReleaseManifest({ scanner, putObject: makeRecordingPutObject(calls) });

            const files = validateReleaseManifest(manifest);
            assert(files.length > 0, 'expected the manifest to validate into a non-empty file list');

            assert(manifest.pages['/'], 'expected a page entry at the root pathname');
            assert(manifest.pages['/'].metadata, 'expected page metadata reference');
            assert(manifest.pages['/'].partials, 'expected page partials reference');
            assert(manifest.pages['/'].includes, 'expected page includes reference');
            assert(manifest.pages['/'].templates['page.html'], 'expected page template reference');
            assert(manifest.globalTemplatePartials, 'expected globalTemplatePartials reference');
            assert(manifest.baseTemplates, 'expected baseTemplates reference');
            assert(manifest.staticAssets['/images/logo.svg'], 'expected static asset reference');
            assert(manifest.emails['/welcome'], 'expected email reference');
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('calls putObject exactly once per storage pathname with the same bytes getDeveloperBlob returns', async () => {
        const root = await makeWorkspace(FIXTURE_FILES);

        try {
            const scanner = makeScanner(root);
            const recipes = await scanner.scan();
            const calls = [];

            await buildReleaseManifest({ scanner, putObject: makeRecordingPutObject(calls) });

            assertEqual(recipes.size, calls.length);

            const pathnames = calls.map(({ pathname }) => pathname);
            assertEqual(new Set(pathnames).size, pathnames.length);

            for (const { pathname, bytes } of calls) {
                const expected = await getDeveloperBlob(recipes, pathname, 'arrayBuffer');
                assertEqual(await hashBlob(expected), await hashBlob(bytes));
            }
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });

    it('omits an empty facet rather than emitting an empty object', async () => {
        const root = await makeWorkspace({
            'pages/page.json': JSON.stringify({}),
        });

        try {
            const scanner = makeScanner(root);
            const manifest = await buildReleaseManifest({ scanner, putObject: makeRecordingPutObject([]) });

            assertUndefined(manifest.emails);
            assertUndefined(manifest.staticAssets);
            assertUndefined(manifest.globalTemplatePartials);
            assertUndefined(manifest.baseTemplates);

            validateReleaseManifest(manifest);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });
});
