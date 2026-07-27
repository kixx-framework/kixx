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
