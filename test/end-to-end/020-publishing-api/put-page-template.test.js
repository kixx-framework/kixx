import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertNonEmptyString,
    isPlainObject,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';
import { getPublishingApiToken } from '../test-helpers/authenticate.js';
import { TEST_BUILD_ID } from '../test-helpers/publishing-api.js';


const FIXTURE_URL = new URL('../fixtures/publishing-api/page-template.html', import.meta.url);

// Page templates are legitimately nested — `templates/pages/` ships `admin/`,
// `login/`, and `users/` subdirectories — so a deep filepath is this endpoint's
// realistic case rather than an edge case, unlike the flat base template names.
// Three segments also distinguish a handler which joins every matched wildcard
// segment from one which joins only some of them.
const TEMPLATE_FILEPATH = 'e2e/nested/page-template.html';

// Each block writes its own filepath so the blocks stay independent within the
// shared build namespace and none of them overwrites another's target.
const OVERWRITE_TEMPLATE_FILEPATH = 'e2e/nested/overwrite-target.html';

// A filepath whose first segment is literally `pages` collides with the page
// template store's own `pages/` key prefix, which is what makes it a direct test
// of the response's prefix stripping rather than an incidental one. The base
// template suite's equivalent block uses `base/`, so it proves nothing about
// this kind's prefix.
const PREFIXED_TEMPLATE_FILEPATH = 'pages/prefix-check.html';

// Mixed case in every directory segment and the filename, plus an upper case
// extension, so a fold applied to only part of the filepath still fails.
const MIXED_CASE_TEMPLATE_FILEPATH = 'E2E/Nested/Case-Check.HTML';
const FOLDED_TEMPLATE_FILEPATH = 'e2e/nested/case-check.html';

// respondWithUtf8() appends the charset to every JSON:API response.
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


describe('PUT /publishing-api/v1/templates/pages/*filepath with happy path', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/pages/${ TEMPLATE_FILEPATH }`);

        const token = await getPublishingApiToken();
        const source = await fsp.readFile(FIXTURE_URL, 'utf8');

        response = await fetch(url, {
            method: 'PUT',
            redirect: 'manual',
            headers: {
                authorization: `Bearer ${ token }`,
                'kixx-build-id': TEST_BUILD_ID,
                // getContentMediaType() strips media type parameters, so the
                // charset does not interfere with the handler's text/plain check.
                'content-type': 'text/plain; charset=utf-8',
            },
            body: source,
        });

        body = await response.json();
    });

    // The write cannot be read back: the Publishing API exposes no GET route for
    // templates, and TEST_BUILD_ID is not the live build, so the site will not
    // render it either. These tests pin the response contract only.

    it('responds with an HTTP 200 status code', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(url.href, response.url);
    });

    it('responds with a well formatted JSON:API response payload', () => {
        assertEqual(JSON_API_CONTENT_TYPE, response.headers.get('content-type'));
        assert(isPlainObject(body.data));
        assertEqual('Template', body.data.type);
        assertNonEmptyString(body.data.id);
        assert(isPlainObject(body.data.attributes));
    });

    // One concept is spelled three ways along this path: the route segment is
    // `pages`, the reported kind is `page`, and the store prefix is `pages/`. The
    // mapping between them is hand wired in routes/publishing-api-v1.js, where
    // the pattern and the handler are named independently, so asserting the kind
    // is what catches a route table which points `pages` at the wrong handler.
    it('returns the kind, filepath, and buildId in the JSON:API attributes', () => {
        assertEqual('page', body.data.attributes.kind);
        assertEqual(TEMPLATE_FILEPATH, body.data.attributes.filepath);
        assertEqual(TEST_BUILD_ID, body.data.attributes.buildId);
        // The resource id restates the filepath derived from the URL wildcard,
        // rejoined from all three matched segments.
        assertEqual(TEMPLATE_FILEPATH, body.data.id);
    });
});

describe('PUT /publishing-api/v1/templates/pages/*filepath twice for the same filepath', ({ before, it }) => {

    let url;
    let firstResponse;
    let firstBody;
    let secondResponse;
    let secondBody;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/pages/${ OVERWRITE_TEMPLATE_FILEPATH }`);

        const token = await getPublishingApiToken();
        const source = await fsp.readFile(FIXTURE_URL, 'utf8');

        const headers = {
            authorization: `Bearer ${ token }`,
            'kixx-build-id': TEST_BUILD_ID,
            'content-type': 'text/plain; charset=utf-8',
        };

        firstResponse = await fetch(url, {
            method: 'PUT',
            redirect: 'manual',
            headers,
            body: source,
        });

        firstBody = await firstResponse.json();

        // Republish changed source to the same filepath and build. Re-running a
        // publish must be safe, so the store overwrites rather than conflicting.
        secondResponse = await fetch(url, {
            method: 'PUT',
            redirect: 'manual',
            headers,
            body: `${ source }\n{{!-- republished --}}\n`,
        });

        secondBody = await secondResponse.json();
    });

    it('responds with an HTTP 200 status code both times', () => {
        assert(firstResponse);
        assert(secondResponse);
        assertEqual(200, firstResponse.status);
        assertEqual(200, secondResponse.status);
    });

    it('returns an identical JSON:API payload both times', () => {
        // Both payloads come from the same handler expression, so their key
        // order is stable and serializing is a sound way to compare them whole.
        assertEqual(JSON.stringify(firstBody), JSON.stringify(secondBody));
        assertEqual(OVERWRITE_TEMPLATE_FILEPATH, secondBody.data.attributes.filepath);
        assertEqual(TEST_BUILD_ID, secondBody.data.attributes.buildId);
    });
});

describe('PUT /publishing-api/v1/templates/pages/*filepath with a pages-prefixed filepath', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/pages/${ PREFIXED_TEMPLATE_FILEPATH }`);

        const token = await getPublishingApiToken();
        const source = await fsp.readFile(FIXTURE_URL, 'utf8');

        response = await fetch(url, {
            method: 'PUT',
            redirect: 'manual',
            headers: {
                authorization: `Bearer ${ token }`,
                'kixx-build-id': TEST_BUILD_ID,
                'content-type': 'text/plain; charset=utf-8',
            },
            body: source,
        });

        body = await response.json();
    });

    it('responds with an HTTP 200 status code', () => {
        assert(response);
        assertEqual(200, response.status);
        assertEqual(url.href, response.url);
    });

    // The template file store's logical key includes the kind prefix
    // (`pages/pages/prefix-check.html` here), but the URL path already encodes
    // the kind, so the response must report the prefix-less filepath taken from
    // the wildcard. Reporting the store key instead would double the prefix.
    it('returns the filepath without the store key prefix', () => {
        assertEqual(PREFIXED_TEMPLATE_FILEPATH, body.data.attributes.filepath);
        assertEqual(PREFIXED_TEMPLATE_FILEPATH, body.data.id);
        assertEqual('page', body.data.attributes.kind);
    });
});

describe('PUT /publishing-api/v1/templates/pages/*filepath with a mixed case filepath', ({ before, it }) => {

    let mixedCaseUrl;
    let mixedCaseResponse;
    let mixedCaseBody;
    let foldedResponse;
    let foldedBody;

    before(async () => {
        // Construct the URLs here so the test fails if either is invalid
        // instead of crashing the whole test run.
        mixedCaseUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/pages/${ MIXED_CASE_TEMPLATE_FILEPATH }`);
        const foldedUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/pages/${ FOLDED_TEMPLATE_FILEPATH }`);

        const token = await getPublishingApiToken();
        const source = await fsp.readFile(FIXTURE_URL, 'utf8');

        const headers = {
            authorization: `Bearer ${ token }`,
            'kixx-build-id': TEST_BUILD_ID,
            'content-type': 'text/plain; charset=utf-8',
        };

        mixedCaseResponse = await fetch(mixedCaseUrl, {
            method: 'PUT',
            redirect: 'manual',
            headers,
            body: source,
        });

        mixedCaseBody = await mixedCaseResponse.json();

        // Publish the already-folded spelling of the same filepath, so the two
        // payloads can be compared below.
        foldedResponse = await fetch(foldedUrl, {
            method: 'PUT',
            redirect: 'manual',
            headers,
            body: source,
        });

        foldedBody = await foldedResponse.json();
    });

    it('responds with an HTTP 200 status code', () => {
        assert(mixedCaseResponse);
        assertEqual(200, mixedCaseResponse.status);
        // The URL is echoed back as sent; only the reported filepath is folded.
        assertEqual(mixedCaseUrl.href, mixedCaseResponse.url);
    });

    // The publishing edge normalizes every template filepath segment before
    // authorization and the storage write. Reporting that canonical filepath
    // gives the client the same address the service asserts and the store uses.
    it('returns the filepath folded to lower case', () => {
        assertEqual(FOLDED_TEMPLATE_FILEPATH, mixedCaseBody.data.attributes.filepath);
        assertEqual(FOLDED_TEMPLATE_FILEPATH, mixedCaseBody.data.id);
        assertEqual('page', mixedCaseBody.data.attributes.kind);
        assertEqual(TEST_BUILD_ID, mixedCaseBody.data.attributes.buildId);
    });

    // Both spellings resolve to one stored template. That cannot be observed
    // directly from here — templates have no GET route, and TEST_BUILD_ID is not
    // the live build — so this pins the visible half of the contract: the two URLs
    // are answered as the same resource.
    it('returns an identical payload for the already-folded filepath', () => {
        assertEqual(200, foldedResponse.status);
        // Both payloads come from the same handler expression, so their key
        // order is stable and serializing is a sound way to compare them whole.
        assertEqual(JSON.stringify(mixedCaseBody), JSON.stringify(foldedBody));
    });
});
