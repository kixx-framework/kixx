import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
} from 'kixx-assert';
import { getBaseUrl } from '../test-helpers/lib.js';
import { getPublishingApiToken } from '../test-helpers/authenticate.js';
import { TEST_BUILD_ID, getCurrentBuildId } from '../test-helpers/publishing-api.js';


// A real 16x16 RGBA PNG. Binary is the realistic case for this endpoint, and it
// is also the only kind of payload that can catch a byte length measured as a
// string length: the file opens with the non-UTF-8 PNG signature (0x89 'PNG'),
// so any encode/decode round trip on the way to the store would change both the
// length and the hash.
const PNG_FIXTURE_URL = new URL('../fixtures/publishing-api/static-asset.png', import.meta.url);

// A text payload whose extension maps to a media type in mime-types.js, used by
// the blocks that prove the extension is never consulted.
const CSS_FIXTURE_URL = new URL('../fixtures/publishing-api/static-asset.css', import.meta.url);

// Null unless the run supplied E2E_TESTS_BUILD_ID or --build-id, which disables
// the current-build conflict block below. See that block for why.
const CURRENT_BUILD_ID = getCurrentBuildId();

// Assets are served from a path, so a nested filepath is the realistic case.
const ASSET_FILEPATH = 'e2e/nested/static-asset.png';

// Each block writes its own filepath so the blocks stay independent within the
// shared build namespace and none of them overwrites another's target.
const DECLARED_TYPE_ASSET_FILEPATH = 'e2e/nested/declared-type.css';
const PARAMETERIZED_TYPE_ASSET_FILEPATH = 'e2e/nested/parameterized-type.css';

// Single-segment filepaths cover the shape a root-served asset such as a favicon
// takes. Each retry scenario owns an address so the blocks stay independent.
const IDEMPOTENT_ASSET_FILEPATH = 'e2e-identical-retry.css';
const IMMUTABLE_CONFLICT_ASSET_FILEPATH = 'e2e-immutable-conflict.css';

// Mixed case in every directory segment, the filename, and the extension, so a
// fold applied to any part of the filepath still fails.
const MIXED_CASE_ASSET_FILEPATH = 'E2E/Nested/Case-Check.CSS';

// respondWithUtf8() appends the charset to every JSON:API response.
const JSON_API_CONTENT_TYPE = 'application/vnd.api+json; charset=utf-8';


// Every block sends the same request with at most one ingredient changed, so
// this helper owns the valid defaults and each block names only its own
// deviation. The content type is deliberately not defaulted: two blocks below
// exist to make claims about it, so every caller states the value it sends.
async function putStaticAsset(url, body, contentType, options) {
    const { buildId = TEST_BUILD_ID } = options ?? {};

    const token = await getPublishingApiToken();

    const headers = {
        authorization: `Bearer ${ token }`,
        'content-type': contentType,
    };

    if (isNonEmptyString(buildId)) {
        headers['kixx-build-id'] = buildId;
    }

    const response = await fetch(url, {
        method: 'PUT',
        redirect: 'manual',
        headers,
        body,
    });

    return { response, body: await response.json() };
}

// Recomputed here rather than trusted from the response, which is what makes the
// etag assertions worth making: this is the one publishing endpoint whose reply
// carries values derived from the stored bytes rather than echoed from the
// request, so the test can check the server's arithmetic instead of its memory.
// Mirrors sha256Hex() in kixx/utils/crypto.js, including the surrounding quotes
// both store adapters add to make the validator strong.
async function computeStrongEtag(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(
        new Uint8Array(digest),
        (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');

    return `"${ hex }"`;
}


describe('PUT /publishing-api/v1/assets/*filepath with happy path', ({ before, it }) => {

    let url;
    let bytes;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ ASSET_FILEPATH }`);

        // Read as bytes, with no encoding, so the fixture reaches the request
        // body exactly as it sits on disk.
        bytes = await fsp.readFile(PNG_FIXTURE_URL);

        result = await putStaticAsset(url, bytes, 'image/png');
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    it('responds with a well formatted JSON:API response payload', () => {
        assertEqual(JSON_API_CONTENT_TYPE, result.response.headers.get('content-type'));
        assert(isPlainObject(result.body.data));
        assertEqual('StaticAsset', result.body.data.type);
        assertNonEmptyString(result.body.data.id);
        assert(isPlainObject(result.body.data.attributes));
    });

    it('returns the filepath, buildId, and content type in the JSON:API attributes', () => {
        assertEqual(ASSET_FILEPATH, result.body.data.attributes.filepath);
        assertEqual(ASSET_FILEPATH, result.body.data.id);
        assertEqual(TEST_BUILD_ID, result.body.data.attributes.buildId);
        assertEqual('image/png', result.body.data.attributes.contentType);
    });

    // The cache validators are the store's own product, not the handler's echo of
    // the request: StaticFileStore.write() computes them from the buffered bytes
    // and persists them so later reads serve them without re-hashing. Recomputing
    // them here checks that the bytes the store hashed are the bytes this test
    // sent — a store that truncated or re-encoded the body would still report a
    // well formed etag, just not this one.
    //
    // Both runtime adapters use the same scheme (quoted SHA-256 via sha256Hex),
    // so these assertions hold against a Node.js and a Cloudflare target alike.
    it('returns cache validators computed from the written bytes', async () => {
        assertEqual(bytes.byteLength, result.body.data.attributes.contentLength);
        assertEqual(await computeStrongEtag(bytes), result.body.data.attributes.etag);
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with a content type contradicting the extension', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ DECLARED_TYPE_ASSET_FILEPATH }`);

        const bytes = await fsp.readFile(CSS_FIXTURE_URL);

        // A `.css` filepath published as something else entirely. The two values
        // have to disagree for the assertion below to mean anything.
        result = await putStaticAsset(url, bytes, 'text/plain');
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // An asset is arbitrary binary, so the client declares its media type and the
    // handler never infers one from the filename. The stored type is what later
    // reads serve, so an inference leaking in from the read path — getContentType()
    // in mime-types.js maps `css` to `text/css; charset=utf-8` — would silently
    // overrule the publisher. The store falls back to extension detection only
    // when the content type argument is empty, which this endpoint prevents by
    // rejecting a missing Content-Type outright (400 ContentTypeRequired).
    it('stores the declared content type rather than the detected one', () => {
        assertEqual('text/plain', result.body.data.attributes.contentType);
        assertEqual(DECLARED_TYPE_ASSET_FILEPATH, result.body.data.attributes.filepath);
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with content type parameters', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ PARAMETERIZED_TYPE_ASSET_FILEPATH }`);

        const bytes = await fsp.readFile(CSS_FIXTURE_URL);

        result = await putStaticAsset(url, bytes, 'Text/CSS; charset=utf-8');
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // getContentMediaType() lowercases the media type and drops every parameter,
    // and the store persists exactly that string — so the charset a publisher
    // declares here is not what a reader will later be served. This is a real
    // consequence rather than a formatting detail, which is why it is pinned:
    // a client that needs a charset on the wire has to know it will not survive
    // the write.
    it('stores the media type without parameters, folded to lower case', () => {
        assertEqual('text/css', result.body.data.attributes.contentType);
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with a mixed case filepath', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ MIXED_CASE_ASSET_FILEPATH }`);

        const bytes = await fsp.readFile(CSS_FIXTURE_URL);

        result = await putStaticAsset(url, bytes, 'text/css');
    });

    it('responds with an HTTP 200 status code', () => {
        assert(result.response);
        assertEqual(200, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // Assets are the one publishing resource whose filepath is case-preserving,
    // and the reason is the read path: StaticAssetRequestHandler looks the URL
    // pathname up in the store verbatim, so an asset published under a folded key
    // is unreachable at the URL that names it. Hyperview template, page, and
    // include addresses are canonicalized instead, so this assertion keeps that
    // intentionally narrower policy from reaching static assets.
    it('preserves the filepath case exactly as sent', () => {
        assertEqual(MIXED_CASE_ASSET_FILEPATH, result.body.data.attributes.filepath);
        assertEqual(MIXED_CASE_ASSET_FILEPATH, result.body.data.id);
        assertEqual(TEST_BUILD_ID, result.body.data.attributes.buildId);
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with an identical retry', ({ before, it }) => {

    let url;
    let firstResult;
    let secondResult;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ IDEMPOTENT_ASSET_FILEPATH }`);

        const bytes = await fsp.readFile(CSS_FIXTURE_URL);

        firstResult = await putStaticAsset(url, bytes, 'text/css');
        secondResult = await putStaticAsset(url, bytes, 'text/css');
    });

    it('responds with an HTTP 200 status code both times', () => {
        assert(firstResult.response);
        assert(secondResult.response);
        assertEqual(200, firstResult.response.status);
        assertEqual(200, secondResult.response.status);
    });

    it('returns the existing resource parts for both writes', () => {
        assertEqual(IDEMPOTENT_ASSET_FILEPATH, firstResult.body.data.attributes.filepath);
        assertEqual(IDEMPOTENT_ASSET_FILEPATH, secondResult.body.data.attributes.filepath);
        assertEqual(IDEMPOTENT_ASSET_FILEPATH, secondResult.body.data.id);
        assertEqual(TEST_BUILD_ID, secondResult.body.data.attributes.buildId);
        assertEqual(firstResult.body.data.attributes, secondResult.body.data.attributes);
    });
});

describe('PUT /publishing-api/v1/assets/*filepath with conflicting bytes', ({ before, it }) => {

    let assetUrl;
    let firstBytes;
    let firstResult;
    let secondResult;
    let assetResponse;

    before(async () => {
        const url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ IMMUTABLE_CONFLICT_ASSET_FILEPATH }`);
        firstBytes = await fsp.readFile(CSS_FIXTURE_URL);
        const secondBytes = new TextEncoder().encode(
            `${ new TextDecoder().decode(firstBytes) }.e2e-republished { color: #c0ffee; }\n`,
        );

        firstResult = await putStaticAsset(url, firstBytes, 'text/css');
        secondResult = await putStaticAsset(url, secondBytes, 'text/css');
        assetUrl = new URL(`${ getBaseUrl() }/assets/${ TEST_BUILD_ID }/${ IMMUTABLE_CONFLICT_ASSET_FILEPATH }`);
        assetResponse = await fetch(assetUrl);
    });

    it('returns an immutable conflict for the second write', () => {
        assertEqual(200, firstResult.response.status);
        assertEqual(409, secondResult.response.status);
        const [ error ] = secondResult.body.errors;
        assertEqual('409', error.status);
        assertEqual('StaticAssetImmutableConflict', error.code);
        assertEqual('ConflictError', error.title);
    });

    it('continues to serve the first representation at its public asset URL', async () => {
        assertEqual(200, assetResponse.status);
        assertEqual('text/css', assetResponse.headers.get('content-type'));
        assertEqual('public, max-age=31536000, immutable', assetResponse.headers.get('cache-control'));
        assertEqual(firstResult.body.data.attributes.etag, assetResponse.headers.get('etag'));
        assertEqual(firstBytes, new Uint8Array(await assetResponse.arrayBuffer()));
    });
});

// Disabled unless the run was told which build the target deployment is currently
// serving. The id cannot be discovered over HTTP, and a local dev server has no
// current build at all — putStaticAsset() reads it as null, which no non-empty
// header value can ever equal — so without the configuration this branch is
// unreachable rather than merely untested. Disabling reports that in the run
// summary instead of passing quietly.
//
// Unlike the gated blocks in put-page-metadata.test.js and put-page-include.test.js,
// which publish into the live build to exercise their fallback, this block asserts a
// refusal and therefore writes nothing to the target deployment.
describe('PUT /publishing-api/v1/assets/*filepath targeting the current build', ({ before, it }) => {

    let url;
    let result;

    before(async () => {
        // Construct the URL here so the test fails if it is invalid
        // instead of crashing the whole test run.
        url = new URL(`${ getBaseUrl() }/publishing-api/v1/assets/${ ASSET_FILEPATH }`);

        const bytes = await fsp.readFile(PNG_FIXTURE_URL);

        result = await putStaticAsset(url, bytes, 'image/png', { buildId: CURRENT_BUILD_ID });
    });

    // A 200 here means the configured build id is not the one the deployment is
    // serving, so the write went to an ordinary namespace. That is a misconfigured
    // run, not a passing one.
    it('responds with an HTTP 409 status code', () => {
        assert(result.response);
        assertEqual(409, result.response.status);
        assertEqual(url.href, result.response.url);
    });

    // Asset writes are staged-only: the live site is serving this namespace, and an
    // asset overwritten in place would change the running site's bytes underneath
    // the ETags already handed to clients — the opposite of the atomic deployment
    // model, where a build is staged under its own id and swapped in. Note this is
    // the *opposite* rule from page metadata and includes, which deliberately allow
    // the live build so content can be edited in place.
    it('returns the error in a well formatted JSON:API payload', () => {
        assertEqual(JSON_API_CONTENT_TYPE, result.response.headers.get('content-type'));
        assert(Array.isArray(result.body.errors));
        assertEqual(1, result.body.errors.length);

        const [ error ] = result.body.errors;
        assertEqual('409', error.status);
        assertEqual('CurrentBuildWriteConflict', error.code);
        assertEqual('ConflictError', error.title);
        assertEqual('Static asset writes must target a build other than the current build.', error.detail);
    });
}, { disabled: CURRENT_BUILD_ID === null });
