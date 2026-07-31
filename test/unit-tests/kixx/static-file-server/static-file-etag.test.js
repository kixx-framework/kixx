import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { computeStaticFileEtag } from '../../../../src/kixx/static-file-server/static-file-etag.js';


describe('computeStaticFileEtag', ({ it }) => {
    it('returns a quoted lowercase SHA-256 ETag', async () => {
        const etag = await computeStaticFileEtag(new Uint8Array([ 1, 2, 3 ]));

        assertEqual('"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"', etag);
    });
});
