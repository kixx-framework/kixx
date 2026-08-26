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


const FIXTURE_URL = new URL('../fixtures/publishing-api/page-include.md', import.meta.url);

const INCLUDE_FILEPATH = 'e2e/nested/body.md';

// A leading dot on a path segment is rejected by validatePathname() before the
// filepath reaches the page data store. Path traversal is not testable from here:
// the URL parser normalizes `..` away before the request is sent, and the router
// does not percent decode wildcard segments, so an encoded `..` would be rejected
// for containing `%` instead.
const INVALID_INCLUDE_FILEPATH = 'e2e/nested/.hidden.md';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block below is the happy-path request with exactly one ingredient
// changed, so this helper owns the valid defaults and each block names only its
// own deviation. Reading the blocks side by side then shows the variable under
// test and nothing else.
//
// None of these requests reaches the page data store, so none of them writes
// anything — unlike the happy-path test, they leave the build namespace empty.
async function putPageInclude(options) {
    const {
        filepath = INCLUDE_FILEPATH,
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
    const url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ filepath }`);

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


describe('PUT /publishing-api/v1/includes/*filepath without an authorization header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageInclude({ authorization: null });
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

describe('PUT /publishing-api/v1/includes/*filepath with an unknown bearer token', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageInclude({
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

describe('PUT /publishing-api/v1/includes/*filepath with an unsupported content type', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageInclude({ contentType: 'application/json' });
    });

    it('responds with an HTTP 415 status code', () => {
        assert(result.response);
        assertEqual(415, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // The accepted range is `text/*` rather than the `text/plain` the template
    // endpoints require, so the detail differs from theirs by more than the noun.
    // The happy-path file publishes a `text/markdown` include, which is what
    // makes this a boundary rather than a blanket rejection.
    //
    // UnsupportedMediaTypeError carries an `accept` list, but the router's
    // JSON:API fallback does not put it on the wire, so there is nothing to
    // assert about it here.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '415',
            code: 'UNSUPPORTED_MEDIA_TYPE_ERROR',
            title: 'UnsupportedMediaTypeError',
            detail: 'Include writes require a text/* Content-Type.',
        });
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with an empty request body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putPageInclude({ body: '' });
    });

    // An empty body is client input, but the page data store treats a blank
    // source as a broken invariant (AssertionError -> 500), so putInclude()
    // has to reject it first for this to be a 400 at all.
    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'IncludeSourceRequired',
            title: 'BadRequestError',
            detail: 'Include source text is required.',
        });
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with an invalid filepath', ({ before, it }) => {

    let result;

    before(async () => {
        // Everything except the filepath is valid here. Unlike the template
        // endpoints, whose handler checks the content type before touching the
        // wildcard, this route resolves the filepath in its authorization gate
        // (requireIncludePermission) — which runs before the handler — so an
        // invalid filepath outranks an invalid content type on this endpoint.
        // Keeping every other ingredient valid means the block does not depend
        // on that ordering to be a test about the filepath.
        result = await putPageInclude({ filepath: INVALID_INCLUDE_FILEPATH });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // validatePathname() echoes the filepath it rejected, which is the wildcard
    // segments rejoined as the client sent them — before any case folding and
    // without the leading slash the owning page's pathname carries.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: `Invalid pathname: ${ INVALID_INCLUDE_FILEPATH }`,
        });
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with an empty path segment', ({ before, it }) => {

    let result;

    before(async () => {
        // The doubled slash survives URL normalization, so the router sees an
        // empty wildcard segment. Both page data store adapters would otherwise
        // disagree about where this resource belongs.
        result = await putPageInclude({ filepath: 'e2e//nested/body.md' });
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
            detail: 'Include filepath must not contain empty path segments.',
        });
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with a trailing slash', ({ before, it }) => {

    let result;

    before(async () => {
        // The motivating case for the empty-segment check on this endpoint: a
        // trailing slash makes the *last* segment empty, and the last segment is
        // the filename. Without the check, the write reaches
        // HyperviewService.putIncludeContent() with an empty filename, where it
        // is an invariant violation (AssertionError -> 500) rather than the
        // client error it actually is. The doubled-slash block above cannot
        // catch a regression here, because a check that only looked at the
        // directory segments would still pass it.
        result = await putPageInclude({ filepath: `${ INCLUDE_FILEPATH }/` });
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
            detail: 'Include filepath must not contain empty path segments.',
        });
    });
});

// Not covered here: the 403 PublishingApiTokenForbidden branch of
// requireIncludePermission. It is unreachable end-to-end today — `Editor` is the
// only publishing role, it grants `include:put` on
// `urn:kixx:publishing:include:*`, and CreatePublishingApiTokenForm defaults an
// omitted or empty roles submission back to `Editor` — so there is no token this
// suite can mint that the gate denies. The per-filepath URN scoping the resolver
// builds is therefore only observable from a unit test of assertPermission().
