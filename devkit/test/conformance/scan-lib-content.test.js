import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import scanContentSources from '../../lib/publishing/scan-content-sources.js';
import { makeReleaseManifest } from '../../lib/publishing/publish-content.js';
import { canonicalize } from '../../lib/publishing/addressing.js';
// Dev-only: conformance tests may read the repo's lib/ to prove devkit accepts
// exactly what the application accepts.
import {
    validateReleaseManifest,
    validateStructuredContent,
} from '../../../lib/kixx/content-addressable-store/release-manifest.js';


const LIB_DIRECTORY = fileURLToPath(new URL('../../../lib/', import.meta.url));

// Scanner resource type to lib's structured content kind.
const STRUCTURED_KINDS = {
    GlobalTemplatePartials: 'globalTemplatePartials',
    BaseTemplates: 'baseTemplates',
    PageMetadata: 'pageMetadata',
    PagePartials: 'pagePartials',
    PageIncludes: 'pageIncludes',
    EmailAssets: 'email',
};


describe('scanContentSources conformance with lib content', ({ before, it }) => {
    let scan;

    before(async () => {
        // Read-only: the scanner only reads, and the real file system is used
        // so the result reflects lib's actual tree.
        scan = await scanContentSources(LIB_DIRECTORY);
    });

    it('scans repo lib/ with no problems', () => {
        assertEqual('[]', JSON.stringify(scan.problems));
        assert(scan.resources.length > 0, 'expected resources');
    });

    it('reports lib/templates/README.md as unmatched, not as a problem', () => {
        assert(scan.unmatchedFiles.includes('templates/README.md'), scan.unmatchedFiles.join(', '));
    });

    it('produces structured payloads lib accepts', () => {
        let checked = 0;

        for (const resource of scan.resources) {
            const kind = STRUCTURED_KINDS[resource.type];

            if (kind) {
                const content = JSON.parse(canonicalize(resource.payload));
                validateStructuredContent(kind, content, `/${ resource.type }${ resource.pathname }`);
                checked += 1;
            }
        }

        assert(checked > 0, 'expected structured resources');
    });

    it('builds a Release manifest lib validates', () => {
        const files = validateReleaseManifest(makeReleaseManifest(scan.resources));

        assertEqual(scan.resources.length, files.length);
    });
});
