import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import {
    createPublishingApiToken,
    revokePublishingApiToken,
} from '../test-helpers/publishing-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import { createRunPrefix } from './helpers.js';


const RUN_PREFIX = createRunPrefix();

// The token-mint endpoint only accepts publishing-capable roles, so a valid
// token lacking a Publishing API permission cannot be created through public
// APIs. Discovery requires a valid bearer token but no additional grant, so
// it is the endpoint every credential state below is checked against.

let missingCredentialsResponse;
let malformedCredentialsResponse;
let unknownCredentialsResponse;
let revokedCredentialsResponse;


describe('Publishing API authentication boundary', ({ before, it }) => {

    before(async () => {
        missingCredentialsResponse = await getDiscovery();
        malformedCredentialsResponse = await getDiscovery({ authorization: 'not-a-bearer-credential' });
        unknownCredentialsResponse = await getDiscovery({ authorization: `Bearer kxpat_${ crypto.randomUUID() }` });

        const publishingToken = await createPublishingApiToken({
            description: `${ RUN_PREFIX } authentication coverage`,
        });
        await revokePublishingApiToken(publishingToken.id);
        revokedCredentialsResponse = await getDiscovery({
            authorization: `Bearer ${ publishingToken.token }`,
        });
    });

    it('rejects missing bearer credentials', () => {
        assertErrorResponse(missingCredentialsResponse, 401, 'UNAUTHENTICATED_ERROR');
    });

    it('rejects malformed bearer credentials', () => {
        assertErrorResponse(malformedCredentialsResponse, 401, 'UNAUTHENTICATED_ERROR');
    });

    it('rejects unknown bearer credentials', () => {
        assertErrorResponse(unknownCredentialsResponse, 401, 'UNAUTHENTICATED_ERROR');
    });

    it('rejects revoked bearer credentials', () => {
        assertErrorResponse(revokedCredentialsResponse, 403, 'PublishingApiTokenInactive');
    });
});

async function getDiscovery(headers) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/`, { headers });

    return {
        status: response.status,
        body: await response.json(),
    };
}

function assertErrorResponse(response, status, code) {
    assertEqual(status, response.status);
    assertEqual(String(status), response.body.errors[0].status);
    assertEqual(code, response.body.errors[0].code);
}
