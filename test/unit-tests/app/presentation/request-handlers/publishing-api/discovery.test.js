import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { getDiscovery } from '../../../../../../src/app/presentation/request-handlers/publishing-api/discovery.js';


describe('Publishing API discovery', ({ it }) => {

    it('reports the running build, contract, format, and enforced limits', () => {
        const response = getDiscovery(
            { runtime: { build: { id: 'build-42' } } },
            {},
            new ServerResponse(),
        );
        const attributes = JSON.parse(response.body).data.attributes;

        assertEqual('build-42', attributes.runningBuildId);
        assertEqual(1, attributes.contentContractVersion);
        assertEqual(3, attributes.addressingFormat);
        assertEqual(100, attributes.limits.maxObjectStatusIds);
        assertEqual(10_000, attributes.limits.maxManifestEntries);
    });
});
