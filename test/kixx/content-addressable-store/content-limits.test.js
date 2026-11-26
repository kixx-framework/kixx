import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import * as contentLimits from '../../../kixx/content-addressable-store/content-limits.js';
import * as publishingApi from '../../../kixx/publishing-api/mod.js';
import * as publishingApiConstants from '../../../kixx/publishing-api/constants.js';


describe('content-addressable-store/content-limits', ({ it }) => {

    it('holds the content store limits (PERF-1)', () => {
        assertEqual(25 * 1024 * 1024, contentLimits.MAX_OBJECT_BYTES);
        assertEqual(10_000, contentLimits.MAX_MANIFEST_ENTRIES);
    });

    it('is where the Publishing API gets its limits', () => {
        assertEqual(contentLimits.MAX_OBJECT_BYTES, publishingApiConstants.MAX_OBJECT_BYTES);
        assertEqual(contentLimits.MAX_MANIFEST_ENTRIES, publishingApiConstants.MAX_MANIFEST_ENTRIES);
        assertEqual(contentLimits.MAX_OBJECT_BYTES, publishingApi.MAX_OBJECT_BYTES);
        assertEqual(contentLimits.MAX_MANIFEST_ENTRIES, publishingApi.MAX_MANIFEST_ENTRIES);
    });
});
