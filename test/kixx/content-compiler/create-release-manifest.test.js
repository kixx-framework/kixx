import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { canonicalize } from '../../../kixx/content-addressable-store/addressing.js';
import { validateReleaseManifest } from '../../../kixx/content-addressable-store/release-manifest.js';
import { createReleaseManifest } from '../../../kixx/content-compiler/create-release-manifest.js';


// Any valid object id will do: the builder copies it.
const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeObject(type, pathname, hash = HASH_A, size = 1) {
    return { type, pathname, payload: 'x', hash, size, sourceFiles: [] };
}

describe('content-compiler/create-release-manifest', ({ it }) => {
    it('returns the empty manifest for no objects', () => {
        assertEqual('{"pages":{},"staticAssets":{}}', canonicalize(createReleaseManifest([])));
    });

    it('places every object type', () => {
        const manifest = createReleaseManifest([
            makeObject('BaseTemplates', '/', HASH_A, 10),
            makeObject('GlobalTemplatePartials', '/', HASH_B, 11),
            makeObject('PageIncludes', '/about', HASH_A, 12),
            makeObject('PageMetadata', '/about', HASH_B, 13),
            makeObject('PagePartials', '/about', HASH_A, 14),
            makeObject('PageTemplate', '/about/about.html', HASH_B, 15),
            makeObject('PageMetadata', '/', HASH_A, 16),
            makeObject('PageTemplate', '/page.html', HASH_B, 17),
            makeObject('StaticAsset', 'images/logo.png', HASH_A, 18),
        ]);

        assertEqual(JSON.stringify({
            staticAssets: {
                '/images/logo.png': { objectId: HASH_A, size: 18 },
            },
            pages: {
                '/about': {
                    includes: { objectId: HASH_A, size: 12 },
                    metadata: { objectId: HASH_B, size: 13 },
                    partials: { objectId: HASH_A, size: 14 },
                    templates: {
                        'about.html': { objectId: HASH_B, size: 15 },
                    },
                },
                '/': {
                    metadata: { objectId: HASH_A, size: 16 },
                    templates: {
                        'page.html': { objectId: HASH_B, size: 17 },
                    },
                },
            },
            baseTemplates: { objectId: HASH_A, size: 10 },
            globalTemplatePartials: { objectId: HASH_B, size: 11 },
        }, null, 2), JSON.stringify(manifest, null, 2));

        assertEqual(9, validateReleaseManifest(manifest).length);
    });

    it('leaves out the template bundles when there are none', () => {
        const manifest = createReleaseManifest([ makeObject('PageMetadata', '/') ]);

        assertEqual(false, Object.hasOwn(manifest, 'baseTemplates'));
        assertEqual(false, Object.hasOwn(manifest, 'globalTemplatePartials'));
    });

    it('carries a media type only for a static asset that has one', () => {
        const manifest = createReleaseManifest([
            { ...makeObject('StaticAsset', 'a.txt'), mediaType: 'text/plain' },
            makeObject('StaticAsset', 'b.txt'),
            { ...makeObject('PageMetadata', '/'), mediaType: 'application/json' },
        ]);

        assertEqual('text/plain', manifest.staticAssets['/a.txt'].mediaType);
        assertEqual(false, Object.hasOwn(manifest.staticAssets['/b.txt'], 'mediaType'));
        assertEqual(false, Object.hasOwn(manifest.pages['/'].metadata, 'mediaType'));
    });

    it('refuses an object type it has no place for', () => {
        let caught = null;

        try {
            createReleaseManifest([ makeObject('EmailAssets', '/welcome') ]);
        } catch (error) {
            caught = error;
        }

        assertEqual('AssertionError', caught.name);
    });
});
