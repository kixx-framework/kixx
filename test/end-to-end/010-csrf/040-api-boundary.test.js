import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/authenticate.js';
import { getBaseUrl, getRenderedRecordIds } from '../test-helpers/lib.js';


let adminCookies;
let adminApiResponse;
let tokenIdsBeforeAdminApiRequest;
let tokenIdsAfterAdminApiRequest;
let publishingApiResponse;
let homePageBeforePublishingApiRequest;
let homePageAfterPublishingApiRequest;


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

        const homeUrl = new URL(getBaseUrl());
        homePageBeforePublishingApiRequest = await fetchText(homeUrl);
        publishingApiResponse = await submitPublishingApiTemplateWrite();
        homePageAfterPublishingApiRequest = await fetchText(homeUrl);
    });

    it('does not let an admin browser cookie authenticate an Admin API mutation', () => {
        assertUnauthenticatedResponse(adminApiResponse, 'HTTP Basic credentials are required.');
        assertEqual(tokenIdsBeforeAdminApiRequest.join(','), tokenIdsAfterAdminApiRequest.join(','));
    });

    it('does not let an admin browser cookie authenticate a Publishing API mutation', () => {
        assertUnauthenticatedResponse(publishingApiResponse, 'Publishing API authentication is required.');
        assertEqual(homePageBeforePublishingApiRequest, homePageAfterPublishingApiRequest);
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

async function submitPublishingApiTemplateWrite() {
    const pathname = `/publishing-api/v1/resources/page-templates/csrf-api-${ crypto.randomUUID() }`;
    const response = await fetch(`${ getBaseUrl() }${ pathname }`, {
        method: 'PUT',
        redirect: 'manual',
        headers: {
            cookie: adminCookies.cookieHeader(),
            'content-type': 'text/plain',
        },
        body: '<main>browser-cookie API boundary</main>',
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

async function fetchText(url) {
    const response = await fetch(url, { redirect: 'manual' });

    assertEqual(200, response.status);
    return response.text();
}

function assertUnauthenticatedResponse(response, detail) {
    assertEqual(401, response.status);
    assertEqual('401', response.body.errors[0].status);
    assertEqual('UnauthenticatedError', response.body.errors[0].title);
    assertEqual(detail, response.body.errors[0].detail);
}
