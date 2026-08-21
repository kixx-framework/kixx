// This suite targets URL paths (e.g. `/publishing-api/v1/templates/**`)
// that predate the current routes in src/routes/publishing-api-v1.js
// (`/publishing-api/v1/resources/**` and `/publishing-api/v1/index/**`). It
// is already obsolete against the current routes for reasons unrelated to
// and predating agents/plans/hyperview-content-service.md, and its passing
// or failing is not a signal about that work. See test/end-to-end/README.md.

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


const FIXTURE_URL = new URL('../fixtures/publishing-api/page-metadata.json', import.meta.url);

const PAGE_PATHNAME = 'e2e/nested/page-metadata';

// A leading dot on a path segment is rejected by validatePathname() before the
// pathname reaches the page data store. Path traversal is not testable from here:
// the URL parser normalizes `..` away before the request is sent, and the router
// does not percent decode wildcard segments, so an encoded `..` would be rejected
// for containing `%` instead.
const INVALID_PAGE_PATHNAME = 'e2e/nested/.hidden';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const JSON_API_RESPONSE_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block below is the happy-path request with exactly one ingredient
// changed, so this helper owns the valid defaults and each block names only its
// own deviation. Reading the blocks side by side then shows the variable under
// test and nothing else.
//
// None of these requests reaches the page data store, so none of them writes
// anything — unlike the happy-path test, they leave the build namespace empty.
async function putPageMetadata(options) {
    const {
        pathname = PAGE_PATHNAME,
        buildId = TEST_BUILD_ID,
        contentType = JSON_API_CONTENT_TYPE,
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
    // survives; only an absent body falls back to the fixture document.
    const body = isUndefined(options?.body)
        ? await readFixtureDocument()
        : options.body;

    // Construct the URL here so the test fails if it is invalid
    // instead of crashing the whole test run.
    const url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ pathname }`);

    const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body,
    });

    return { url, response, body: await response.json() };
}

// Returns the serialized JSON:API document every valid request sends. The
// optional transform mutates the resource object — not the envelope — so a block
// which corrupts the resource still sends a well formed document around it.
async function readFixtureDocument(transform) {
    const attributes = JSON.parse(await fsp.readFile(FIXTURE_URL, 'utf8'));

    const data = {
        type: 'PageMetadata',
        attributes,
    };

    return JSON.stringify({ data: transform ? transform(data) : data });
}

// The JSON:API error envelope is identical across every failure mode, so it is
// asserted in one place and each block only names its own status, code, title,
// and detail.
function assertSingleJsonApiError(result, expected) {
    assertEqual(JSON_API_RESPONSE_CONTENT_TYPE, result.response.headers.get('content-type'));
    assert(Array.isArray(result.body.errors));
    assertEqual(1, result.body.errors.length);

    const [ error ] = result.body.errors;
    assertEqual(expected.status, error.status);
    assertEqual(expected.code, error.code);
    assertEqual(expected.title, error.title);
    assertEqual(expected.detail, error.detail);
}


describe('PUT /publishing-api/v1/pages/*pathname without an authorization header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({ authorization: null });
    });

    // Authentication is virtual host inbound middleware, so it runs before this
    // route is selected at all — the failure is reported the same way whichever
    // publishing resource the URL names.
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

describe('PUT /publishing-api/v1/pages/*pathname with an unknown bearer token', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({
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

describe('PUT /publishing-api/v1/pages/*pathname with an unsupported content type', ({ before, it }) => {

    let result;

    before(async () => {
        // Plain JSON is the near miss worth rejecting: the body below is valid
        // JSON, so only the media type distinguishes this from the happy path.
        result = await putPageMetadata({ contentType: 'application/json' });
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
            detail: 'Request Content-Type must be application/vnd.api+json.',
        });
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with an empty path segment', ({ before, it }) => {

    let result;

    before(async () => {
        // The doubled slash survives URL normalization, so the router sees an
        // empty wildcard segment. Collapsing it would let one page be addressed —
        // and authorized — under two different URNs.
        result = await putPageMetadata({ pathname: 'e2e//nested/page-metadata' });
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
            detail: 'Page pathname must not contain empty path segments.',
        });
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with an invalid pathname', ({ before, it }) => {

    let result;

    before(async () => {
        // Everything except the pathname is valid here, so nothing else can
        // short circuit ahead of the pathname check.
        result = await putPageMetadata({ pathname: INVALID_PAGE_PATHNAME });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // validatePathname() echoes the pathname it rejected, which for a page is the
    // wildcard segments rejoined *with* a leading slash — pages are validated as
    // URL pathnames, unlike template filepaths, which carry no leading slash. The
    // check also runs in the authorization resolver, ahead of the handler, so this
    // 400 is reported before the request body is looked at.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: `Invalid pathname: /${ INVALID_PAGE_PATHNAME }`,
        });
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with a mismatched resource type', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({
            body: await readFixtureDocument((data) => {
                return Object.assign(data, { type: 'Page' });
            }),
        });
    });

    // A type mismatch is a 409 rather than a 400 because the document is well
    // formed — it just describes a resource this endpoint does not own.
    it('responds with an HTTP 409 status code', () => {
        assert(result.response);
        assertEqual(409, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '409',
            code: 'JsonApiResourceTypeMismatch',
            title: 'ConflictError',
            detail: 'JSON:API resource type must be PageMetadata.',
        });
    });
});

describe('PUT /publishing-api/v1/pages/*pathname without a metadata version', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({
            body: await readFixtureDocument((data) => {
                Reflect.deleteProperty(data.attributes, 'version');
                return data;
            }),
        });
    });

    // `version` is the one attribute PutPageMetadataForm requires, because the
    // live-build full-page and includes caches key on it: a page republished to the
    // current build without a changed version serves stale cached content.
    it('responds with an HTTP 422 status code', () => {
        assert(result.response);
        assertEqual(422, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // This is the only failure mode on this endpoint raised as a ValidationError,
    // which carries child entries in `error.errors`. Each child becomes its own
    // JSON:API error object wearing the parent's status, code, and name, so the
    // envelope looks like every other one here except that `detail` is the child's
    // message and `source` names the offending field.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '422',
            code: 'VALIDATION_ERROR',
            title: 'ValidationError',
            detail: 'Page metadata version is required',
        });

        const [ error ] = result.body.errors;
        assertEqual('version', error.source);
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with a malformed JSON body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({ body: '{"data":' });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // The parse failure is raised by the platform request adapter, not by this
    // endpoint, so this also pins that both adapters translate a body they cannot
    // parse into the same client error rather than an opaque 500.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: 'Invalid JSON in request body',
        });
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with an empty request body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageMetadata({ body: '' });
    });

    // An empty body is not a distinct error here the way it is for the template
    // endpoints, which check the source text themselves and report
    // TemplateSourceRequired. Page metadata never reaches its own validation: an
    // empty body is not parseable JSON, so it fails in request.json() first.
    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: 'Invalid JSON in request body',
        });
    });
});
