import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    isPlainObject,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';
import { getPublishingApiToken } from '../test-helpers/authenticate.js';
import { TEST_BUILD_ID, getCurrentBuildId } from '../test-helpers/publishing-api.js';


const FIXTURE_URL = new URL('../fixtures/publishing-api/page-metadata.json', import.meta.url);

// Null unless the run supplied E2E_TESTS_BUILD_ID or --build-id, which disables
// the live-build fallback block at the bottom of this file. See that block for why.
const CURRENT_BUILD_ID = getCurrentBuildId();

// Pages nest arbitrarily deep, so a multi-segment pathname is this endpoint's
// realistic case. Three segments also distinguish a handler which rejoins every
// matched wildcard segment from one which rejoins only some of them.
const PAGE_PATHNAME = 'e2e/nested/page-metadata';

// Each block writes its own pathname so the blocks stay independent within the
// shared build namespace and none of them overwrites another's target.
const OVERWRITE_PAGE_PATHNAME = 'e2e/nested/overwrite-target';
const ATTRIBUTES_PAGE_PATHNAME = 'e2e/nested/attributes-echo';

// Mixed case in every directory segment and the last segment, so a fold applied
// to only part of the pathname still fails.
const MIXED_CASE_PAGE_PATHNAME = 'E2E/Nested/Case-Check';
const FOLDED_PAGE_PATHNAME = '/e2e/nested/case-check';

// Written to the deployment's *live* build by the gated block below, so it is
// deliberately a pathname no real site would use.
const LIVE_BUILD_PAGE_PATHNAME = 'e2e/nested/current-build-fallback';

// Unlike the template endpoints, which take the source as text/plain, page
// metadata is submitted as a JSON:API document.
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

// respondWithUtf8() appends the charset to every JSON:API response.
const JSON_API_RESPONSE_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// The stored metadata bag is echoed back verbatim, so every block needs its own
// copy to mutate without disturbing the others.
async function readFixtureMetadata() {
    return JSON.parse(await fsp.readFile(FIXTURE_URL, 'utf8'));
}

function jsonApiDocument(attributes) {
    return JSON.stringify({
        data: {
            type: 'PageMetadata',
            attributes,
        },
    });
}

async function putPageMetadata(url, attributes, buildId) {
    const token = await getPublishingApiToken();

    const headers = {
        authorization: `Bearer ${ token }`,
        'content-type': JSON_API_CONTENT_TYPE,
    };

    // Omitted entirely by the live-build block, which is testing the fallback
    // this header suppresses.
    if (buildId) {
        headers['kixx-build-id'] = buildId;
    }

    const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body: jsonApiDocument(attributes),
    });

    return { response, body: await response.json() };
}


describe('PUT /publishing-api/v1/pages/*pathname with happy path', ({ before, it }) => {

    let url;
    let metadata;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ PAGE_PATHNAME }`);

        metadata = await readFixtureMetadata();
        result = await putPageMetadata(url, metadata, TEST_BUILD_ID);
    });

    // The write cannot be read back: the Publishing API exposes no GET route for
    // page metadata, and TEST_BUILD_ID is not the live build, so the site will not
    // render it either. These tests pin the response contract only.

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    it('responds with a well formatted JSON:API response payload', () => {
        assertEqual(JSON_API_RESPONSE_CONTENT_TYPE, result.response.headers.get('content-type'));
        assert(isPlainObject(result.body.data));
        assertEqual('PageMetadata', result.body.data.type);
        assert(isPlainObject(result.body.data.attributes));
    });

    // The resource id is the pathname rejoined from all three matched wildcard
    // segments and prefixed with a slash, because that is the form page reads
    // resolve — `/` is a pathname here, not a filepath like the template routes
    // report.
    it('returns the pathname as the resource id', () => {
        assertEqual(`/${ PAGE_PATHNAME }`, result.body.data.id);
    });

    // Unlike the template responses, which carry the build id in `attributes`
    // alongside the kind and filepath, `attributes` here is the caller's metadata
    // bag verbatim — so the build id has nowhere to go but `meta`.
    it('returns the build id in the resource meta', () => {
        assert(isPlainObject(result.body.data.meta));
        assertEqual(TEST_BUILD_ID, result.body.data.meta.buildId);
    });
});

describe('PUT /publishing-api/v1/pages for the site root', ({ before, it }) => {

    let rootUrl;
    let rootResult;
    let trailingSlashResult;

    before(async () => {
        // Construct the URLs here so the test fails if either is invalid
        // instead of crashing the whole test run.
        rootUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/pages`);
        const trailingSlashUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/`);

        const metadata = await readFixtureMetadata();

        rootResult = await putPageMetadata(rootUrl, metadata, TEST_BUILD_ID);
        trailingSlashResult = await putPageMetadata(trailingSlashUrl, metadata, TEST_BUILD_ID);
    });

    // The route pattern is `/pages{/*pathname}` — an optional wildcard group. A
    // bare `/pages/*pathname` requires at least one segment, so this request would
    // miss the PUT target entirely and fall through to the catch-all GET/HEAD
    // route, which answers 405. No template route has a no-segments case, so
    // nothing else in this suite covers the optional group.
    it('responds with an HTTP 200 status code', () => {
        assert(rootResult.response);
        assertEqual(200, rootResult.response.status);
        assertEqual(rootUrl.href, rootResult.response.url);
    });

    it('returns the site root pathname as the resource id', () => {
        assertEqual('/', rootResult.body.data.id);
        assertEqual(TEST_BUILD_ID, rootResult.body.data.meta.buildId);
    });

    // A trailing slash produces no wildcard segments either, so the root has no
    // slash variant to reject — both spellings address the one root page rather
    // than two keys differing by a slash.
    it('answers the trailing slash spelling as the same resource', () => {
        assertEqual(200, trailingSlashResult.response.status);
        // Both payloads come from the same handler expression, so their key
        // order is stable and serializing is a sound way to compare them whole.
        assertEqual(JSON.stringify(rootResult.body), JSON.stringify(trailingSlashResult.body));
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with a mixed case pathname', ({ before, it }) => {

    let mixedCaseUrl;
    let mixedCaseResult;
    let foldedResult;

    before(async () => {
        // Construct the URLs here so the test fails if either is invalid
        // instead of crashing the whole test run.
        mixedCaseUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ MIXED_CASE_PAGE_PATHNAME }`);
        const foldedUrl = new URL(`${ getBaseUrl() }/publishing-api/v1/pages${ FOLDED_PAGE_PATHNAME }`);

        const metadata = await readFixtureMetadata();

        mixedCaseResult = await putPageMetadata(mixedCaseUrl, metadata, TEST_BUILD_ID);
        // Publish the already-folded spelling of the same pathname, so the two
        // payloads can be compared below.
        foldedResult = await putPageMetadata(foldedUrl, metadata, TEST_BUILD_ID);
    });

    it('responds with an HTTP 200 status code', () => {
        assert(mixedCaseResult.response);
        assertEqual(200, mixedCaseResult.response.status);
        // The URL is echoed back as sent; only the reported pathname is folded.
        assertEqual(mixedCaseUrl.href, mixedCaseResult.response.url);
    });

    // Page pathnames are normalized at the publishing edge before authorization
    // and the storage write. Folding every segment makes any case variant name
    // the same resource on both case-sensitive and case-insensitive stores.
    it('returns the pathname folded to lower case', () => {
        assertEqual(FOLDED_PAGE_PATHNAME, mixedCaseResult.body.data.id);
        assertEqual(TEST_BUILD_ID, mixedCaseResult.body.data.meta.buildId);
    });

    // Both spellings resolve to one stored page. That cannot be observed directly
    // from here — page metadata has no GET route, and TEST_BUILD_ID is not the live
    // build — so this pins the visible half of the contract: the two URLs are
    // answered as the same resource. It also proves the authorization URN and the
    // written key agree, since the permission gate resolves the pathname through
    // the same helper the handler uses.
    it('returns an identical payload for the already-folded pathname', () => {
        assertEqual(200, foldedResult.response.status);
        assertEqual(JSON.stringify(mixedCaseResult.body), JSON.stringify(foldedResult.body));
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with a non-canonical include filename', ({ before, it }) => {

    let result;

    before(async () => {
        const url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/e2e/nested/non-canonical-include`);
        const metadata = await readFixtureMetadata();

        metadata.includes.body.filename = 'Body.MD';
        result = await putPageMetadata(url, metadata, TEST_BUILD_ID);
    });

    it('responds with an HTTP 400 status code', () => {
        assert(result.response);
        assertEqual(400, result.response.status);
    });

    it('identifies the non-canonical include key in the JSON:API error', () => {
        assertEqual(JSON_API_RESPONSE_CONTENT_TYPE, result.response.headers.get('content-type'));
        assert(Array.isArray(result.body.errors));
        assertEqual(1, result.body.errors.length);

        const [ error ] = result.body.errors;
        assertEqual('400', error.status);
        assertEqual('InvalidIncludeFilename', error.code);
        assertEqual('BadRequestError', error.title);
        assertEqual(
            'Page metadata includes[body].filename must be a valid, lower-case Hyperview identifier.',
            error.detail,
        );
    });
});

describe('PUT /publishing-api/v1/pages/*pathname twice for the same pathname', ({ before, it }) => {

    let url;
    let firstResult;
    let secondResult;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ OVERWRITE_PAGE_PATHNAME }`);

        const metadata = await readFixtureMetadata();

        firstResult = await putPageMetadata(url, metadata, TEST_BUILD_ID);

        // Republish changed metadata to the same pathname and build. Re-running a
        // publish must be safe, so the write fully replaces rather than conflicting
        // or merging. The version changes because the live-build caches key on it.
        const republished = Object.assign(await readFixtureMetadata(), {
            version: 'e2e-fixture-2',
        });

        secondResult = await putPageMetadata(url, republished, TEST_BUILD_ID);
    });

    it('responds with an HTTP 200 status code both times', () => {
        assert(firstResult.response);
        assert(secondResult.response);
        assertEqual(200, firstResult.response.status);
        assertEqual(200, secondResult.response.status);
    });

    // The response reports the metadata as submitted, so the second payload must
    // carry the new version rather than the stored one. Anything else would mean
    // the write merged with the existing file instead of replacing it.
    it('returns the republished metadata in the second payload', () => {
        assertEqual('e2e-fixture-1', firstResult.body.data.attributes.version);
        assertEqual('e2e-fixture-2', secondResult.body.data.attributes.version);
        assertEqual(`/${ OVERWRITE_PAGE_PATHNAME }`, secondResult.body.data.id);
        assertEqual(TEST_BUILD_ID, secondResult.body.data.meta.buildId);
    });
});

describe('PUT /publishing-api/v1/pages/*pathname with unrecognized metadata attributes', ({ before, it }) => {

    let metadata;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        const url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ ATTRIBUTES_PAGE_PATHNAME }`);

        // Values of every JSON type, nested, alongside a key no part of the
        // application knows about.
        metadata = Object.assign(await readFixtureMetadata(), {
            unknownAttribute: {
                enabled: true,
                count: 7,
                absent: null,
                tags: [ 'one', 'two' ],
            },
        });

        result = await putPageMetadata(url, metadata, TEST_BUILD_ID);
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
    });

    // PutPageMetadataForm declares `additionalProperties: true` and validates only
    // `version`, because a page's metadata bag is open ended — templates read
    // arbitrary keys out of it. The form must therefore pass the whole bag through
    // untouched rather than projecting it onto a known schema, and the response
    // echo is the only place that contract is observable over HTTP.
    it('returns the submitted metadata bag verbatim', () => {
        // The response attributes are a structuredClone of the parsed request
        // attributes, so their key order matches the submitted document and
        // serializing is a sound way to compare them whole.
        assertEqual(JSON.stringify(metadata), JSON.stringify(result.body.data.attributes));
    });
});

// Disabled unless the run was told which build the target deployment is currently
// serving. Omitting the `kixx-build-id` header makes putPageMetadata() fall back
// to the deployment's current build, and this block asserts the fallback resolved
// to that build — which it can only do with the id in hand. The value cannot be
// discovered over HTTP, so it has to be supplied out of band. Disabling reports
// that in the run summary instead of passing quietly.
//
// Note this is the *opposite* rule from the template endpoints, which refuse a
// current-build write with a 409: page metadata writes deliberately allow the live
// build so content can be edited in place (see HyperviewService#putPageMetadata).
// This block therefore publishes a real page into the running deployment, which
// nothing removes afterward.
//
// The other half of the fallback — a deployment with no current build at all,
// where putPageMetadata() throws a 409 CurrentBuildIdRequired — is not covered
// here. No configuration distinguishes "the run was not told the build id" from
// "the deployment has no build id", so a block gated the other way would write to
// the live build of any deployment run without --build-id.
describe('PUT /publishing-api/v1/pages/*pathname without a build id header', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/pages/${ LIVE_BUILD_PAGE_PATHNAME }`);

        const metadata = await readFixtureMetadata();

        result = await putPageMetadata(url, metadata, null);
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
        assertEqual(CURRENT_BUILD_ID, result.body.data.meta.buildId);
        assertEqual(`/${ LIVE_BUILD_PAGE_PATHNAME }`, result.body.data.id);
    });
}, { disabled: CURRENT_BUILD_ID === null });
