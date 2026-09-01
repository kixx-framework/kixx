import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { createRelease } from '../../../../../../src/app/presentation/request-handlers/publishing-api/releases.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';


function makeRequest(manifest) {
    return {
        getContentMediaType: () => JSON_API_CONTENT_TYPE,
        json: async () => ({ data: { type: 'Release', attributes: { manifest } } }),
    };
}

describe('Publishing API Releases', ({ it }) => {

    it('publishes inline text content in one request', async () => {
        const uploads = [];
        const store = {
            async putObject(_context, payload) {
                uploads.push(payload);
            },
            async createRelease(_context, manifest) {
                const reference = manifest.staticAssets['/site.txt'];
                assert(typeof reference.objectId === 'string');
                assertEqual(2, reference.size);
                return { releaseId: 'release-1', objectCount: 1, totalBytes: 2, contractVersion: 1 };
            },
        };
        const record = { toObject: () => ({ id: 'release-1', releaseId: 'release-1' }) };
        const context = {
            user: { id: 'token-1' },
            getService: () => store,
            getCollection: () => ({ create: async () => record }),
        };
        const response = await createRelease(context, makeRequest({
            staticAssets: { '/site.txt': { content: 'hi', mediaType: 'text/plain' } },
        }), new ServerResponse());

        assertEqual(201, response.status);
        assertEqual(1, uploads.length);
    });

    it('turns malformed manifests into expected validation errors', async () => {
        const context = {
            user: { id: 'token-1' },
            getService: () => ({ putObject: async () => {} }),
        };
        let error;
        try {
            await createRelease(context, makeRequest({ staticAssets: 'wrong' }), new ServerResponse());
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual(true, error.expected);
    });
});
