import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import assetUrl from '../../../../../src/kixx/hyperview/helpers/asset-url.js';

describe('assetUrl', ({ it }) => {
    it('renders a fingerprinted URL for a published asset', () => {
        assertEqual(
            '/assets/asset-hash/site.css',
            assetUrl({}, {}, { '/site.css': 'asset-hash' }, '/site.css'),
        );
    });

    it('falls back to the bare pathname for an unpublished asset', () => {
        assertEqual('/site.css', assetUrl({}, {}, {}, '/site.css'));
    });

    it('HTML-escapes helper output', () => {
        assertEqual('/files/a&amp;b.css', assetUrl({}, {}, {}, '/files/a&b.css'));
    });
});
