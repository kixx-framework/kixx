import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import PublishingAPIClient from '../../../lib/publishing/publishing-api-client.js';


const RELEASE_ID = 'a'.repeat(26);
const ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000001';

// Protocol 4 requires an intent on every build write. The v6 client infers it
// from the precondition: a never-assigned build is a pre-stage.
describe('PublishingAPIClient#assignBuild intent', ({ it }) => {
    it('sends intent prestage for a never-assigned build', async () => {
        const { client, requests } = makeClient();

        await client.assignBuild('next', RELEASE_ID, { expectedAssignmentId: null, reason: 'carry-forward' });

        const { attributes } = JSON.parse(requests[0].init.body).data;
        assertEqual('prestage', attributes.intent);
        assertEqual('intent,releaseId,expectedAssignmentId,reason', Object.keys(attributes).join(','));
        assertEqual(null, attributes.expectedAssignmentId);
    });

    it('sends intent publish for an assigned build', async () => {
        const { client, requests } = makeClient();

        await client.assignBuild('production', RELEASE_ID, { expectedAssignmentId: ASSIGNMENT_ID });

        const { attributes } = JSON.parse(requests[0].init.body).data;
        assertEqual('publish', attributes.intent);
        assertEqual(ASSIGNMENT_ID, attributes.expectedAssignmentId);
        assertEqual('publish', attributes.reason);
    });
});

function makeClient() {
    const requests = [];

    async function fetch(url, init) {
        requests.push({ url, init });
        const { data } = JSON.parse(init.body);
        const body = {
            data: {
                type: 'Build',
                id: data.id,
                attributes: {
                    releaseId: data.attributes.releaseId,
                    assignedAt: '2026-11-25T00:00:00.000Z',
                    assignmentId: ASSIGNMENT_ID,
                    code: null,
                    liveSourceRevision: null,
                },
            },
        };
        return await Promise.resolve(new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/vnd.api+json' },
        }));
    }

    const client = new PublishingAPIClient({ origin: 'https://example.com', token: 'kxdk_test', fetch });
    return { client, requests };
}
