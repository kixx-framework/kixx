import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import * as mod from '../../../../../../src/app/presentation/request-handlers/publishing-api/mod.js';
import { putPageInclude } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-page-include.js';
import { putPageMetadata } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-page-metadata.js';
import { putStaticAsset } from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-static-asset.js';
import {
    putBaseTemplate,
    putPageTemplate,
    putPartialTemplate,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/put-template.js';


describe('publishing API request handlers mod', ({ it }) => {

    it('re-exports every publishing API request handler', () => {
        // virtual-hosts.js wires routes from this barrel, so a dropped or
        // renamed export breaks route registration at startup.
        assertEqual(putPageInclude, mod.putPageInclude);
        assertEqual(putPageMetadata, mod.putPageMetadata);
        assertEqual(putStaticAsset, mod.putStaticAsset);
        assertEqual(putBaseTemplate, mod.putBaseTemplate);
        assertEqual(putPageTemplate, mod.putPageTemplate);
        assertEqual(putPartialTemplate, mod.putPartialTemplate);
    });

    it('exports nothing beyond the six request handlers', () => {
        const exportedNames = Object.keys(mod).sort();

        assertEqual(6, exportedNames.length);
        assertEqual([
            'putBaseTemplate',
            'putPageInclude',
            'putPageMetadata',
            'putPageTemplate',
            'putPartialTemplate',
            'putStaticAsset',
        ].join(','), exportedNames.join(','));
    });
});
