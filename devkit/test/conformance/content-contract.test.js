import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { CONTENT_CONTRACT_VERSION } from '../../lib/publishing/negotiate-capabilities.js';
import { makeReleaseManifest } from '../../lib/publishing/publish-content.js';
import { canonicalize, getBlobSize, hashBlob } from '../../lib/publishing/addressing.js';
// Conformance tests may read core to prove the devkit composes exactly what
// core accepts.
import { CONTENT_CONTRACT_VERSION as CORE_CONTENT_CONTRACT_VERSION } from '../../../kixx/content-addressable-store/content-addressable-store.js';
import { validateReleaseManifest } from '../../../kixx/content-addressable-store/release-manifest.js';


describe('content contract conformance with core', ({ it }) => {
    it('pins the content contract core serves', () => {
        assertEqual(CORE_CONTENT_CONTRACT_VERSION, CONTENT_CONTRACT_VERSION);
    });

    it('composes a Release manifest core accepts', () => {
        const resources = [
            makeResource('StaticAsset', 'site.css', 'body {}', 'text/css'),
            makeResource('GlobalTemplatePartials', '/', [ { id: 'header.html', source: '<header></header>' } ]),
            makeResource('BaseTemplates', '/', [ { id: 'default.html', source: '<html></html>' } ]),
            makeResource('PageMetadata', '/about', { page: { title: 'About' } }),
            makeResource('PagePartials', '/about', [ { id: 'card.html', source: '<article></article>' } ]),
            makeResource('PageIncludes', '/about', { body: '<p>About</p>' }),
            makeResource('PageTemplate', '/about/page.html', '<main></main>'),
        ];

        const manifest = makeReleaseManifest(resources);
        const files = validateReleaseManifest(manifest);

        assertEqual(resources.length, files.length);
        assertEqual(
            'baseTemplates,globalTemplatePartials,pages,staticAssets',
            Object.keys(manifest).sort().join(','),
        );
    });
});

// Structured payloads are hashed in their canonical JSON form, as the scanner
// does, so each reference names a real object id.
function makeResource(type, pathname, payload, mediaType) {
    const bytes = typeof payload === 'string' ? payload : canonicalize(payload);

    return {
        type,
        pathname,
        payload,
        hash: hashBlob(bytes),
        size: getBlobSize(bytes),
        mediaType,
        sourceFiles: [],
    };
}
