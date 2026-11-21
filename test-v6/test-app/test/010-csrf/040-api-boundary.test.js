import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { getRenderedRecordIds } from './helpers.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


let adminCookies;
let adminApiResponse;
let tokenIdsBeforeAdminApiRequest;
let tokenIdsAfterAdminApiRequest;
let publishingApiResponse;


describe('CSRF API credential boundary', ({ before, it }) => {

    before(async () => {
        adminCookies = await loginRootAdmin();

        const tokenListUrl = new URL(`${ getBaseUrl() }/admin/publishing-api-tokens`);
        tokenIdsBeforeAdminApiRequest = getRenderedRecordIds(
            await fetchHtml(tokenListUrl),
            'token_id',
        );
        adminApiResponse = await submitAdminApiTokenCreate();
        tokenIdsAfterAdminApiRequest = getRenderedRecordIds(
            await fetchHtml(tokenListUrl),
            'token_id',
        );

        publishingApiResponse = await fetchPublishingApiDiscovery();
    });

    it('does not let an admin browser cookie authenticate an Admin API mutation', () => {
        assertUnauthenticatedResponse(adminApiResponse, 'HTTP Basic credentials are required.');
        assertEqual(tokenIdsBeforeAdminApiRequest.join(','), tokenIdsAfterAdminApiRequest.join(','));
    });

    it('does not let an admin browser cookie authenticate to the Publishing API', () => {
        assertUnauthenticatedResponse(publishingApiResponse, 'Publishing API authentication is required.');
    });
});

async function submitAdminApiTokenCreate() {
    const response = await fetch(`${ getBaseUrl() }/admin-api/v1/publishing-api-tokens`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
            cookie: adminCookies.cookieHeader(),
            'content-type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
            data: {
                type: 'PublishingApiToken',
                attributes: {
                    description: 'browser-cookie API boundary',
                },
            },
        }),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

async function fetchPublishingApiDiscovery() {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/`, {
        redirect: 'manual',
        headers: {
            cookie: adminCookies.cookieHeader(),
        },
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

async function fetchHtml(url) {
    const response = await fetch(url, {
        redirect: 'manual',
        headers: { cookie: adminCookies.cookieHeader() },
    });
    adminCookies.applyResponse(response);

    assertEqual(200, response.status);
    return response.text();
}

function assertUnauthenticatedResponse(response, detail) {
    assertEqual(401, response.status);
    assertEqual('401', response.body.errors[0].status);
    assertEqual('UnauthenticatedError', response.body.errors[0].title);
    assertEqual(detail, response.body.errors[0].detail);
}
