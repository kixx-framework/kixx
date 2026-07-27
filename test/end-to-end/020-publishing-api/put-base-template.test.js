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


const FIXTURE_URL = new URL('../fixtures/publishing-api/base-template.html', import.meta.url);

// A multi-segment filepath exercises the `*filepath` wildcard: a single segment
// could not distinguish a handler which joins the matched segments from one
// which only takes the last.
const TEMPLATE_FILEPATH = 'e2e/base-template.html';

// A leading dot on a path segment is rejected by validatePathname() before the
// filepath reaches the template file store. Path traversal is not testable from
// here: the URL parser normalizes `..` away before the request is sent, and the
// router does not percent decode wildcard segments, so an encoded `..` would be
// rejected for containing `%` instead.
const INVALID_TEMPLATE_FILEPATH = 'e2e/.hidden.html';

// Each block writes its own filepath so the blocks stay independent within the
// shared build namespace and none of them overwrites another's target.
const OVERWRITE_TEMPLATE_FILEPATH = 'e2e/overwrite-target.html';

// A filepath whose first segment is literally `base` collides with the store's
// own `base/` key prefix, which is what makes it a direct test of the response's
// prefix stripping rather than an incidental one.
const PREFIXED_TEMPLATE_FILEPATH = 'base/prefix-check.html';

// Mixed case in both a directory segment and the filename, plus an upper case
// extension, so a fold applied to only part of the filepath still fails.
const MIXED_CASE_TEMPLATE_FILEPATH = 'E2E/Case-Check.HTML';
const FOLDED_TEMPLATE_FILEPATH = 'e2e/case-check.html';

// respondWithUtf8() appends the charset to every JSON:API response.
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


describe('PUT /publishing-api/v1/templates/base/*filepath with happy path', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ TEMPLATE_FILEPATH }`);

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

    it('returns the kind, filepath, and buildId in the JSON:API attributes', () => {
        assertEqual('base', body.data.attributes.kind);
        assertEqual(TEMPLATE_FILEPATH, body.data.attributes.filepath);
        assertEqual(TEST_BUILD_ID, body.data.attributes.buildId);
        // The resource id restates the filepath derived from the URL wildcard.
        assertEqual(TEMPLATE_FILEPATH, body.data.id);
    });
});

describe('PUT /publishing-api/v1/templates/base/*filepath twice for the same filepath', ({ before, it }) => {

    let url;
    let firstResponse;
    let firstBody;
    let secondResponse;
    let secondBody;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ OVERWRITE_TEMPLATE_FILEPATH }`);

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

describe('PUT /publishing-api/v1/templates/base/*filepath with a base-prefixed filepath', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ PREFIXED_TEMPLATE_FILEPATH }`);

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
    // (`base/base/prefix-check.html` here), but the URL path already encodes the
    // kind, so the response must report the prefix-less filepath taken from the
    // wildcard. Reporting the store key instead would double the prefix.
    it('returns the filepath without the store key prefix', () => {
        assertEqual(PREFIXED_TEMPLATE_FILEPATH, body.data.attributes.filepath);
        assertEqual(PREFIXED_TEMPLATE_FILEPATH, body.data.id);
        assertEqual('base', body.data.attributes.kind);
    });
});

describe('PUT /publishing-api/v1/templates/base/*filepath with a mixed case filepath', ({ before, it }) => {

    let mixedCaseUrl;
    let mixedCaseResponse;
    let mixedCaseBody;
    let foldedResponse;
    let foldedBody;

    before(async () => {
        // Construct the URLs here so the test fails if either is invalid
        // instead of crashing the whole test run.
        mixedCaseUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ MIXED_CASE_TEMPLATE_FILEPATH }`);
        const foldedUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ FOLDED_TEMPLATE_FILEPATH }`);

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

    // Hyperview folds every base, page, and partial template id to lower case
    // before reading or writing it (HyperviewService#normalizeTemplateId), so the
    // template is stored at `base/e2e/case-check.html` no matter which spelling
    // was requested. Reporting the URL wildcard unchanged would hand the client a
    // filepath naming a key that does not exist.
    it('returns the filepath folded to lower case', () => {
        assertEqual(FOLDED_TEMPLATE_FILEPATH, mixedCaseBody.data.attributes.filepath);
        assertEqual(FOLDED_TEMPLATE_FILEPATH, mixedCaseBody.data.id);
        assertEqual('base', mixedCaseBody.data.attributes.kind);
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

describe('PUT /publishing-api/v1/templates/base/*filepath with an invalid filepath', ({ before, it }) => {

    let url;
    let response;
    let body;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ INVALID_TEMPLATE_FILEPATH }`);

        const token = await getPublishingApiToken();
        const source = await fsp.readFile(FIXTURE_URL, 'utf8');

        // Everything except the filepath is valid here. The handler checks the
        // content type first, and the virtual host authenticates before routing,
        // so any other invalid ingredient would short circuit to a 415 or 401 and
        // this would no longer be a test about the filepath.
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

    it('responds with an HTTP 400 status code', () => {
        assert(response);
        assertEqual(400, response.status);
        assertEqual(url.href, response.url);
    });

    it('responds with a well formatted JSON:API response payload', () => {
        assertEqual(JSON_API_CONTENT_TYPE, response.headers.get('content-type'));
        assert(Array.isArray(body.errors));
        assertEqual(1, body.errors.length);
    });

    it('returns the error in the JSON:API payload', () => {
        const [ error ] = body.errors;
        assertEqual('400', error.status);
        assertEqual('BAD_REQUEST_ERROR', error.code);
        assertEqual('BadRequestError', error.title);
        assertEqual(`Invalid pathname: ${ INVALID_TEMPLATE_FILEPATH }`, error.detail);
    });
});
