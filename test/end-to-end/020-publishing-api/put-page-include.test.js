import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    isNonEmptyString,
    isPlainObject,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';
import { getPublishingApiToken } from '../test-helpers/authenticate.js';
import { TEST_BUILD_ID, getCurrentBuildId } from '../test-helpers/publishing-api.js';


const FIXTURE_URL = new URL('../fixtures/publishing-api/page-include.md', import.meta.url);

// Null unless the run supplied E2E_TESTS_BUILD_ID or --build-id, which disables
// the live-build fallback block at the bottom of this file. See that block for why.
const CURRENT_BUILD_ID = getCurrentBuildId();

// An include belongs to a page, and pages nest arbitrarily deep, so a
// multi-segment filepath is this endpoint's realistic case. The last segment is
// the filename and the ones before it are the owning page's pathname, so three
// segments are the fewest that show the split doing anything.
const INCLUDE_FILEPATH = 'e2e/nested/body.md';
const INCLUDE_PATHNAME = '/e2e/nested';
const INCLUDE_FILENAME = 'body.md';

// A single-segment filepath has no directory segments at all, which makes it an
// include of the site root page rather than a malformed request.
const ROOT_INCLUDE_FILEPATH = 'e2e-root-include.md';

// Mixed case in both directory segments and in the filename, including the
// extension. Only the directory segments may be folded, so a filepath with upper
// case on both sides of the split is the only shape that fails a fold applied to
// all of it or to none of it.
const MIXED_CASE_INCLUDE_FILEPATH = 'E2E/Nested/Body-Copy.MD';
const MIXED_CASE_INCLUDE_PATHNAME = '/e2e/nested';
const MIXED_CASE_INCLUDE_FILENAME = 'Body-Copy.MD';
const MIXED_CASE_REPORTED_FILEPATH = 'e2e/nested/Body-Copy.MD';

// Each block writes its own filepath so the blocks stay independent within the
// shared build namespace and none of them overwrites another's target.
const MARKDOWN_INCLUDE_FILEPATH = 'e2e/nested/markdown-content-type.md';
const OVERWRITE_INCLUDE_FILEPATH = 'e2e/nested/overwrite-target.md';

// Written to the deployment's *live* build by the gated block below, so it is
// deliberately a filepath no real page would reference.
const LIVE_BUILD_INCLUDE_FILEPATH = 'e2e/nested/current-build-fallback.md';

// respondWithUtf8() appends the charset to every JSON:API response.
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block sends the same request with at most one ingredient changed, so
// this helper owns the valid defaults and each block names only its own
// deviation.
async function putPageInclude(url, source, options) {
    const {
        buildId = TEST_BUILD_ID,
        // text/plain is the least interesting media type the handler accepts,
        // which is what makes it the right default: the block that varies it is
        // then the only one making a claim about the media type check.
        contentType = 'text/plain; charset=utf-8',
    } = options ?? {};

    const token = await getPublishingApiToken();

    const headers = {
        authorization: `Bearer ${ token }`,
        'content-type': contentType,
    };

    // Omitted entirely by the live-build block, which is testing the fallback
    // this header suppresses.
    if (isNonEmptyString(buildId)) {
        headers['kixx-build-id'] = buildId;
    }

    const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body: source,
    });

    return { response, body: await response.json() };
}

async function readFixtureSource() {
    return await fsp.readFile(FIXTURE_URL, 'utf8');
}


describe('PUT /publishing-api/v1/includes/*filepath with happy path', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ INCLUDE_FILEPATH }`);

        result = await putPageInclude(url, await readFixtureSource());
    });

    // The write cannot be read back: the Publishing API exposes no GET route for
    // includes, TEST_BUILD_ID is not the live build, and an include is only
    // loaded at render time when the owning page's metadata references it — which
    // nothing here publishes. These tests pin the response contract only.

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    it('responds with a well formatted JSON:API response payload', () => {
        assertEqual(JSON_API_CONTENT_TYPE, result.response.headers.get('content-type'));
        assert(isPlainObject(result.body.data));
        assertEqual('Include', result.body.data.type);
        assert(isPlainObject(result.body.data.attributes));
    });

    // Unlike the template endpoints, which report the filepath as one flat
    // string, this response decomposes the wildcard into the two values the
    // write is actually addressed by: the owning page's pathname and the
    // page-relative filename. The pathname carries a leading slash because that
    // is the form page reads resolve; the filepath in `id` does not, because it
    // restates the URL wildcard.
    it('returns the pathname, filename, and buildId in the JSON:API attributes', () => {
        assertEqual(INCLUDE_PATHNAME, result.body.data.attributes.pathname);
        assertEqual(INCLUDE_FILENAME, result.body.data.attributes.filename);
        assertEqual(TEST_BUILD_ID, result.body.data.attributes.buildId);
        assertEqual(INCLUDE_FILEPATH, result.body.data.id);
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with a single segment filepath', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ ROOT_INCLUDE_FILEPATH }`);

        result = await putPageInclude(url, await readFixtureSource());
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // With no directory segments left after the filename is taken off, the
    // owning page is the site root. splitIncludeFilepath() reports that as '/'
    // rather than an empty string, and the difference is not cosmetic:
    // putIncludeContent() asserts the pathname is a non-empty string, so an
    // empty one would surface as a 500 on a request that is entirely valid.
    // The site root page is a real publishing target, so this is the shape a
    // homepage's `body.md` takes.
    it('returns the site root as the include pathname', () => {
        assertEqual('/', result.body.data.attributes.pathname);
        assertEqual(ROOT_INCLUDE_FILEPATH, result.body.data.attributes.filename);
        assertEqual(ROOT_INCLUDE_FILEPATH, result.body.data.id);
        assertEqual(TEST_BUILD_ID, result.body.data.attributes.buildId);
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with a mixed case filepath', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ MIXED_CASE_INCLUDE_FILEPATH }`);

        result = await putPageInclude(url, await readFixtureSource());
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        // The URL is echoed back as sent; only the reported pathname is folded.
        assertEqual(url.href, result.response.url);
    });

    // The two halves of the filepath follow opposite case rules, which is what
    // makes this the one test that separates the include rule from the template
    // rule:
    //
    // - The directory segments become the page pathname, and Hyperview folds
    //   every page pathname to lower case on reads, so an unfolded write is
    //   stored where no request can find it.
    // - The filename is resolved verbatim from the owning page's
    //   `includes[name].filename` metadata value (HyperviewService.getIncludes),
    //   so folding it would store the file under a name the metadata that
    //   references it never names.
    //
    // The template endpoints fold the whole filepath, so a change that
    // harmonized the two would fold the filename here and pass every other test
    // in this file.
    it('folds the directory segments and preserves the filename case', () => {
        assertEqual(MIXED_CASE_INCLUDE_PATHNAME, result.body.data.attributes.pathname);
        assertEqual(MIXED_CASE_INCLUDE_FILENAME, result.body.data.attributes.filename);
        assertEqual(TEST_BUILD_ID, result.body.data.attributes.buildId);
    });

    // The id recombines the folded directory segments with the unfolded
    // filename, so it names the key that was actually written rather than the
    // wildcard as sent.
    it('returns the recombined filepath as the resource id', () => {
        assertEqual(MIXED_CASE_REPORTED_FILEPATH, result.body.data.id);
    });
});

describe('PUT /publishing-api/v1/includes/*filepath with a text/markdown content type', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ MARKDOWN_INCLUDE_FILEPATH }`);

        result = await putPageInclude(url, await readFixtureSource(), {
            contentType: 'text/markdown; charset=utf-8',
        });
    });

    // Includes accept any `text/*` media type, where the template endpoints
    // accept `text/plain` alone. That is not a leniency worth removing: includes
    // are Markdown in practice, so a `text/plain`-only check would reject the
    // endpoint's real client. This block bounds the check from the accepting
    // side; the 415 block in put-page-include-errors.test.js bounds it from the
    // rejecting side.
    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    it('returns the pathname and filename in the JSON:API attributes', () => {
        assertEqual(INCLUDE_PATHNAME, result.body.data.attributes.pathname);
        assertEqual('markdown-content-type.md', result.body.data.attributes.filename);
        assertEqual(MARKDOWN_INCLUDE_FILEPATH, result.body.data.id);
    });
});

describe('PUT /publishing-api/v1/includes/*filepath twice for the same filepath', ({ before, it }) => {

    let url;
    let firstResult;
    let secondResult;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ OVERWRITE_INCLUDE_FILEPATH }`);

        const source = await readFixtureSource();

        firstResult = await putPageInclude(url, source);

        // Republish changed source to the same filepath and build. Re-running a
        // publish must be safe, so the store overwrites rather than conflicting.
        secondResult = await putPageInclude(url, `${ source }\nRepublished.\n`);
    });

    it('responds with an HTTP 200 status code both times', () => {
        assert(firstResult.response);
        assert(secondResult.response);
        assertEqual(200, firstResult.response.status);
        assertEqual(200, secondResult.response.status);
    });

    // The response describes where the include was written, not what was in it,
    // so republishing changed source must not change any reported value. A
    // differing payload would mean the second write landed somewhere else.
    it('returns an identical JSON:API payload both times', () => {
        // Both payloads come from the same handler expression, so their key
        // order is stable and serializing is a sound way to compare them whole.
        assertEqual(JSON.stringify(firstResult.body), JSON.stringify(secondResult.body));
        assertEqual(INCLUDE_PATHNAME, secondResult.body.data.attributes.pathname);
        assertEqual('overwrite-target.md', secondResult.body.data.attributes.filename);
        assertEqual(TEST_BUILD_ID, secondResult.body.data.attributes.buildId);
    });
});

// Disabled unless the run was told which build the target deployment is currently
// serving. Omitting the `kixx-build-id` header makes putInclude() fall back to the
// deployment's current build, and this block asserts the fallback resolved to that
// build — which it can only do with the id in hand. The value cannot be discovered
// over HTTP, so it has to be supplied out of band. Disabling reports that in the
// run summary instead of passing quietly.
//
// Note this is the *opposite* rule from the template endpoints, which require the
// header (400) and refuse a current-build write (409): include writes deliberately
// allow the live build, matching page metadata, so content can be edited in place.
// This block therefore writes a real file into the running deployment, which
// nothing removes afterward. It is inert until some page's metadata references it,
// which nothing here does.
//
// The other half of the fallback — a deployment with no current build at all,
// where putInclude() throws a 409 CurrentBuildIdRequired — is not covered here. No
// configuration distinguishes "the run was not told the build id" from "the
// deployment has no build id", so a block gated the other way would write to the
// live build of any deployment run without --build-id.
describe('PUT /publishing-api/v1/includes/*filepath without a build id header', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/includes/${ LIVE_BUILD_INCLUDE_FILEPATH }`);

        result = await putPageInclude(url, await readFixtureSource(), { buildId: null });
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // A build id other than the configured one means the fallback did not resolve
    // to the deployment's current build, or the run was configured with a build id
    // that deployment is not serving. Either way the assertion below is the only
    // signal, because no response exposes the current build id on its own.
    it('writes to the deployment current build', () => {
        assertEqual(CURRENT_BUILD_ID, result.body.data.attributes.buildId);
        assertEqual(LIVE_BUILD_INCLUDE_FILEPATH, result.body.data.id);
    });
}, { disabled: CURRENT_BUILD_ID === null });
