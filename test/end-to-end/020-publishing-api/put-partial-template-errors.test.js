import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    isNonEmptyString,
    isUndefined,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';
import { getPublishingApiToken } from '../test-helpers/authenticate.js';
import { TEST_BUILD_ID } from '../test-helpers/publishing-api.js';


const FIXTURE_URL = new URL('../fixtures/publishing-api/partial-template.html', import.meta.url);

const TEMPLATE_FILEPATH = 'e2e/nested/partial-template.html';

// A leading dot on a path segment is rejected by validatePathname() before the
// filepath reaches the template file store. Path traversal is not testable from
// here: the URL parser normalizes `..` away before the request is sent, and the
// router does not percent decode wildcard segments, so an encoded `..` would be
// rejected for containing `%` instead.
const INVALID_TEMPLATE_FILEPATH = 'e2e/nested/.hidden.html';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block below is the happy-path request with exactly one ingredient
// changed, so this helper owns the valid defaults and each block names only its
// own deviation. Reading the blocks side by side then shows the variable under
// test and nothing else.
//
// None of these requests reaches the template file store, so none of them writes
// anything — unlike the happy-path test, they leave the build namespace empty.
async function putPartialTemplate(options) {
    const {
        filepath = TEMPLATE_FILEPATH,
        buildId = TEST_BUILD_ID,
        contentType = 'text/plain; charset=utf-8',
    } = options ?? {};

    // A header is omitted entirely when its value is not a non-empty string,
    // which is how the missing-header blocks express themselves.
    const headers = {};

    if (isUndefined(options?.authorization)) {
        const token = await getPublishingApiToken();
        headers.authorization = `Bearer ${ token }`;
    } else if (isNonEmptyString(options.authorization)) {
        headers.authorization = options.authorization;
    }

    if (isNonEmptyString(buildId)) {
        headers['kixx-build-id'] = buildId;
    }

    if (isNonEmptyString(contentType)) {
        headers['content-type'] = contentType;
    }

    // Defaulted rather than destructured above so an explicitly empty body
    // survives; only an absent body falls back to the fixture.
    const body = isUndefined(options?.body)
        ? await fsp.readFile(FIXTURE_URL, 'utf8')
        : options.body;

    // Construct the URL here so the test fails if it is invalid
    // instead of crashing the whole test run.
    const url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/partials/${ filepath }`);

    const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body,
    });

    return { url, response, body: await response.json() };
}

// The JSON:API error envelope is identical across every failure mode, so it is
// asserted in one place and each block only names its own status, code, title,
// and detail.
function assertSingleJsonApiError(result, expected) {
    assertEqual(JSON_API_CONTENT_TYPE, result.response.headers.get('content-type'));
    assert(Array.isArray(result.body.errors));
    assertEqual(1, result.body.errors.length);

    const [ error ] = result.body.errors;
    assertEqual(expected.status, error.status);
    assertEqual(expected.code, error.code);
    assertEqual(expected.title, error.title);
    assertEqual(expected.detail, error.detail);
}


describe('PUT /publishing-api/v1/templates/partials/*filepath without an authorization header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPartialTemplate({ authorization: null });
    });

    // Authentication is virtual host inbound middleware, so it runs before this
    // route is selected at all — the failure is reported the same way whichever
    // template kind the URL names.
    it('responds with an HTTP 401 status code', () => {
        assert(result.response);
        assertEqual(401, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '401',
            code: 'UNAUTHENTICATED_ERROR',
            title: 'UnauthenticatedError',
            detail: 'Publishing API authentication is required.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath with an unknown bearer token', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPartialTemplate({
            authorization: `Bearer ${ crypto.randomUUID() }`,
        });
    });

    // An unknown token reports exactly what a missing token reports, so the
    // response cannot be used to probe whether a given token value exists.
    it('responds with an HTTP 401 status code', () => {
        assert(result.response);
        assertEqual(401, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '401',
            code: 'UNAUTHENTICATED_ERROR',
            title: 'UnauthenticatedError',
            detail: 'Publishing API authentication is required.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath with an unsupported content type', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPartialTemplate({ contentType: 'application/json' });
    });

    it('responds with an HTTP 415 status code', () => {
        assert(result.response);
        assertEqual(415, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // UnsupportedMediaTypeError carries an `accept` list, but neither
    // mapErrorToJsonApiError() nor jsonApiErrorHandler() puts it on the wire, so
    // there is nothing to assert about it here.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '415',
            code: 'UNSUPPORTED_MEDIA_TYPE_ERROR',
            title: 'UnsupportedMediaTypeError',
            detail: 'Template writes require a text/plain Content-Type.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath without a build id header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPartialTemplate({ buildId: null });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BuildIdRequired',
            title: 'BadRequestError',
            detail: 'Kixx-Build-Id is required for template writes.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath with an empty request body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPartialTemplate({ body: '' });
    });

    // putTemplate() checks the source before the build id, so this stays a
    // source error even though both are supplied correctly here.
    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'TemplateSourceRequired',
            title: 'BadRequestError',
            detail: 'Template source text is required.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath with an invalid filepath', ({ before, it }) => {

    let result;

    before(async () => {
        // Everything except the filepath is valid here. The handler checks the
        // content type first, and the virtual host authenticates before routing,
        // so any other invalid ingredient would short circuit to a 415 or 401 and
        // this would no longer be a test about the filepath.
        result = await putPartialTemplate({ filepath: INVALID_TEMPLATE_FILEPATH });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // validatePathname() echoes the filepath it rejected, which for a template is
    // the wildcard segments rejoined without the store's kind prefix. A detail
    // naming `partials/e2e/...` would mean the store key leaked into a client
    // error.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: `Invalid pathname: ${ INVALID_TEMPLATE_FILEPATH }`,
        });
    });
});

describe('PUT /publishing-api/v1/templates/partials/*filepath with an empty path segment', ({ before, it }) => {

    let result;

    before(async () => {
        // The doubled slash survives URL normalization, so the router sees an
        // empty wildcard segment. Both file store adapters would otherwise
        // disagree about where this resource belongs.
        result = await putPartialTemplate({ filepath: 'e2e//nested/partial-template.html' });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'EmptyPathSegment',
            title: 'BadRequestError',
            detail: 'Template filepath must not contain empty path segments.',
        });
    });
});
