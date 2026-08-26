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
import { TEST_BUILD_ID, getCurrentBuildId } from '../test-helpers/publishing-api.js';


const FIXTURE_URL = new URL('../fixtures/publishing-api/base-template.html', import.meta.url);

// Null unless the run supplied E2E_TESTS_BUILD_ID or --build-id, which disables
// the current-build conflict block below. See that block for why.
const CURRENT_BUILD_ID = getCurrentBuildId();

const TEMPLATE_FILEPATH = 'e2e/base-template.html';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block below is the happy-path request with exactly one ingredient
// changed, so this helper owns the valid defaults and each block names only its
// own deviation. Reading the blocks side by side then shows the variable under
// test and nothing else.
//
// None of these requests reaches the template file store, so none of them writes
// anything — unlike the happy-path test, they leave the build namespace empty.
async function putBaseTemplate(options) {
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
    const url = new URL(`${ getBaseUrl() }/publishing-api/v1/templates/base/${ filepath }`);

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


describe('PUT /publishing-api/v1/templates/base/*filepath without an authorization header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({ authorization: null });
    });

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

describe('PUT /publishing-api/v1/templates/base/*filepath with an unknown bearer token', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({
            authorization: `Bearer ${ crypto.randomUUID() }`,
        });
    });

    it('responds with an HTTP 401 status code', () => {
        assert(result.response);
        assertEqual(401, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // An unknown token reports exactly what a missing token reports, so the
    // response cannot be used to probe whether a given token value exists.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '401',
            code: 'UNAUTHENTICATED_ERROR',
            title: 'UnauthenticatedError',
            detail: 'Publishing API authentication is required.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/base/*filepath with an unsupported content type', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({ contentType: 'application/json' });
    });

    it('responds with an HTTP 415 status code', () => {
        assert(result.response);
        assertEqual(415, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // UnsupportedMediaTypeError carries an `accept` list, but the router's
    // JSON:API fallback does not put it on the wire, so there is nothing to
    // assert about it here.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '415',
            code: 'UNSUPPORTED_MEDIA_TYPE_ERROR',
            title: 'UnsupportedMediaTypeError',
            detail: 'Template writes require a text/plain Content-Type.',
        });
    });
});

describe('PUT /publishing-api/v1/templates/base/*filepath without a build id header', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({ buildId: null });
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

describe('PUT /publishing-api/v1/templates/base/*filepath with an empty request body', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({ body: '' });
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

// Disabled unless the run was told which build the target deployment is
// currently serving. The id cannot be discovered over HTTP, and a local dev
// server has no current build at all — putTemplate() reads it as null, which no
// non-empty header value can ever equal — so without the configuration this
// branch is unreachable rather than merely untested. Disabling reports that in
// the run summary instead of passing quietly.
describe('PUT /publishing-api/v1/templates/base/*filepath targeting the current build', ({ before, it }) => {

    let result;

    before(async () => {
        result = await putBaseTemplate({ buildId: CURRENT_BUILD_ID });
    });

    // A 200 here means the configured build id is not the one the deployment is
    // serving, so the write went to an ordinary namespace. That is a
    // misconfigured run, not a passing one.
    it('responds with an HTTP 409 status code', () => {
        assert(result.response);
        assertEqual(409, result.response.status);
        assertEqual(result.url.href, result.response.url);
    });

    // The live site renders from this namespace, so a publish which overwrote it
    // would change the running site in place — the opposite of the atomic
    // deployment model, where a build is staged under its own id and swapped in.
    // putTemplate() refuses before reaching the Hyperview service, so nothing is
    // written.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertSingleJsonApiError(result, {
            status: '409',
            code: 'CurrentBuildWriteConflict',
            title: 'ConflictError',
            detail: 'Template writes must target a build other than the current build.',
        });
    });
}, { disabled: CURRENT_BUILD_ID === null });

describe('PUT /publishing-api/v1/templates/base/*filepath with an empty path segment', ({ before, it }) => {

    let result;

    before(async () => {
        // The doubled slash survives URL normalization, so the router sees an
        // empty wildcard segment. Both file store adapters would otherwise
        // disagree about where this resource belongs.
        result = await putBaseTemplate({ filepath: 'e2e//base-template.html' });
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
