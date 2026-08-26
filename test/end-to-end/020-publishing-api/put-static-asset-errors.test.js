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


const FIXTURE_URL = new URL('../fixtures/publishing-api/static-asset.png', import.meta.url);

const ASSET_FILEPATH = 'e2e/nested/static-asset.png';

// A leading dot on a path segment is rejected by validatePathname() before the
// filepath reaches the static file store. `.meta` is deliberately the segment
// used here — see the block below. Path traversal is not testable from here: the
// URL parser normalizes `..` away before the request is sent, and the router does
// not percent decode wildcard segments, so an encoded `..` would be rejected for
// containing `%` instead.
const RESERVED_ASSET_FILEPATH = '.meta/evil.css';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block below is the happy-path request with exactly one ingredient
// changed, so this helper owns the valid defaults and each block names only its
// own deviation. Reading the blocks side by side then shows the variable under
// test and nothing else.
//
// None of these requests reaches the static file store, so none of them writes
// anything — unlike the happy-path test, they leave the build namespace empty.
async function putStaticAsset(options) {
    const {
        filepath = ASSET_FILEPATH,
        buildId = TEST_BUILD_ID,
        contentType = 'image/png',
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
    // survives; only an absent body falls back to the fixture. The fixture is
    // read as bytes, with no encoding, so it reaches the request body exactly as
    // it sits on disk.
    const body = isUndefined(options?.body)
        ? await fsp.readFile(FIXTURE_URL)
        : options.body;

    // Construct the URL here so the test fails if it is invalid
    // instead of crashing the whole test run.
    const url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ filepath }`);

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


describe('PUT /publishing-api/v1/assets/*filepath without an authorization header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({ authorization: null });
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

describe('PUT /publishing-api/v1/assets/*filepath with an unknown bearer token', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({
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

describe('PUT /publishing-api/v1/assets/*filepath without a content type', ({ before, it }) => {

    let result;

    before(async () => {
        // fetch() sets a Content-Type of its own for a string body, but not for
        // an ArrayBufferView, so sending the fixture bytes with the header
        // omitted is what actually reaches the handler without one.
        result = await putStaticAsset({ contentType: null });
    });

    // A static asset is arbitrary binary whose media type only the client knows,
    // so an absent Content-Type is a malformed request rather than an unsupported
    // one. This is the opposite classification from the template and include
    // endpoints, which accept a known set of text types and answer 415.
    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'ContentTypeRequired',
            title: 'BadRequestError',
            detail: 'A Content-Type header is required for static asset writes.',
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath without a build id header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({ buildId: null });
    });

    // Asset writes have no live-build fallback: the header is required outright,
    // matching the template endpoints. Page metadata and include writes take the
    // opposite rule and fall back to the current build, so this block is what
    // keeps that fallback from spreading to the one resource whose bytes must stay
    // immutable for the life of a build.
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
            detail: 'Kixx-Build-Id is required for static asset writes.',
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with a reserved build id', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({ buildId: 'dev' });
    });

    it('responds with an HTTP 400 status code', () => {
        assertEqual(400, result.response.status);
    });

    it('returns the reserved Build ID JSON:API error', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'ReservedBuildId',
            title: 'BadRequestError',
            detail: 'The Build ID "dev" is reserved for no-build asset URLs.',
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with a malformed build id', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({ buildId: 'build/child' });
    });

    it('responds with an HTTP 400 status code', () => {
        assertEqual(400, result.response.status);
    });

    it('returns the malformed Build ID JSON:API error', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'InvalidBuildId',
            title: 'BadRequestError',
            detail: 'Build ID must be one safe, non-empty URL path segment.',
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with an empty request body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putStaticAsset({ body: new Uint8Array(0) });
    });

    // putStaticAsset() checks the bytes before the build id, so this stays a
    // source error even though both are supplied correctly here.
    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'StaticAssetSourceRequired',
            title: 'BadRequestError',
            detail: 'Static asset source bytes are required.',
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with a reserved filepath', ({ before, it }) => {

    let result;

    before(async () => {
        // Everything except the filepath is valid here. Unlike the template
        // endpoints, whose handler checks the content type before touching the
        // wildcard, this handler resolves the filepath on its first line — so an
        // invalid filepath outranks a missing content type on this endpoint.
        // Keeping every other ingredient valid means the block does not depend on
        // that ordering to be a test about the filepath.
        result = await putStaticAsset({ filepath: RESERVED_ASSET_FILEPATH });
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // validatePathname() rejects dotfiles before the publishing API can use the
    // pathname in the content-addressable index.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '400',
            code: 'BAD_REQUEST_ERROR',
            title: 'BadRequestError',
            detail: `Invalid pathname: ${ RESERVED_ASSET_FILEPATH }`,
        });
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with an empty path segment', ({ before, it }) => {

    let result;

    before(async () => {
        // The doubled slash survives URL normalization, so the router sees an
        // empty wildcard segment. The two store adapters would otherwise disagree
        // about where this resource belongs: the Node store's path.join() absorbs
        // the empty segment, while the Cloudflare store uses the logical key as
        // the KV key verbatim.
        result = await putStaticAsset({ filepath: 'e2e//nested/static-asset.png' });
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
            detail: 'Static asset filepath must not contain empty path segments.',
        });
    });
});

// Not covered here:
//
// - The 413 PayloadTooLargeError branch guarding the 24 MiB asset cap. Both ways
//   to reach it are unsound from an end-to-end test: uploading 24 MiB to a remote
//   deployment does not fit the suite's 10 second ceiling reliably, and tripping
//   the pre-buffer fast path instead requires a Content-Length that contradicts
//   the body, which breaks HTTP framing. It belongs to a unit test of
//   bufferRequestBodyWithLimit().
//
// - The 403 PublishingApiTokenForbidden branch of requireAssetPermission. It is
//   unreachable end-to-end today — `Editor` is the only publishing role, it grants
//   `asset:put` on `urn:kixx:publishing:asset`, and CreatePublishingApiTokenForm
//   defaults an omitted or empty roles submission back to `Editor` — so there is
//   no token this suite can mint that the gate denies.
