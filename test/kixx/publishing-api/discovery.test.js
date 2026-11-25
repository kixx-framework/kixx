import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import ServerResponse from '../../../kixx/http-router/server-response.js';
import { getDiscovery } from '../../../kixx/publishing-api/discovery.js';
import { readDocument } from './publishing-api-harness.js';


describe('Publishing API discovery', ({ it }) => {

    it('reports the running build, protocol 3, contract, format, and enforced limits', () => {
        const response = getDiscovery(
            { runtime: { build: { id: 'build-42' } } },
            {},
            new ServerResponse(),
        );
        const { data } = readDocument(response);
        const { attributes } = data;

        assertEqual(200, response.status);
        assertEqual('PublishingApi', data.type);
        assertEqual('v1', data.id);
        assertEqual('build-42', attributes.runningBuildId);
        assertEqual(3, attributes.buildAssignmentProtocolVersion);
        assertEqual(2, attributes.contentContractVersion);
        assertEqual(4, attributes.addressingFormat);
        assertEqual(25 * 1024 * 1024, attributes.limits.maxObjectBytes);
        assertEqual(100, attributes.limits.maxObjectStatusIds);
        assertEqual(10_000, attributes.limits.maxManifestEntries);
        assertEqual(
            '["maxObjectBytes","maxObjectStatusIds","maxManifestEntries"]',
            JSON.stringify(Object.keys(attributes.limits)),
        );
        assertEqual(false, Object.hasOwn(attributes.limits, 'maxInlineContentBytes'));
    });

    it('reports a null running build id when none is set', () => {
        const response = getDiscovery({ runtime: { build: {} } }, {}, new ServerResponse());

        assertEqual(null, readDocument(response).data.attributes.runningBuildId);
    });
});
