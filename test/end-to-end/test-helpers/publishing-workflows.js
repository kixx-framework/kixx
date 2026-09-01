import process from 'node:process';
import { URLSearchParams } from 'node:url';
import { assertNonEmptyString } from 'kixx-assert';
import { hashBlob } from '../../../src/kixx/content-addressable-store/addressing.js';
import { loginRootAdmin } from './admin-workflows.js';
import { assertHtmlCsrfToken } from './html.js';
import { getBaseUrl } from './target-url.js';


const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';


/**
 * @typedef {Object} PublishingApiToken
 * @property {string} token - One-time plaintext bearer token.
 * @property {string} id - SHA-256 digest identifying the token record.
 * @property {string[]} roles - Roles granted to the token.
 * @property {string|null} description - Operator-facing token description.
 * @property {string} tokenCreationDate - ISO creation timestamp.
 * @property {string} tokenExpirationDate - ISO expiration timestamp.
 */


/**
 * Mints a Publishing API bearer token through the Admin API.
 * @param {Object} [options] - Token and administrator credentials.
 * @param {string} [options.username] - Root administrator username.
 * @param {string} [options.password] - Root administrator password.
 * @param {string[]} [options.roles] - Publishing roles to grant.
 * @param {number} [options.timeToLiveSeconds] - Requested token lifetime in seconds.
 * @param {string|null} [options.description] - Operator-facing token description.
 * @returns {Promise<PublishingApiToken>} Newly minted token details.
 * @throws {Error} When credentials are absent or the Admin API does not create the token.
 */
export async function createPublishingApiToken(options) {
    const {
        username = process.env.E2E_TESTS_ROOT_USERNAME,
        password = process.env.E2E_TESTS_ROOT_PASSWORD,
        roles,
        timeToLiveSeconds,
        description,
    } = options ?? {};

    assertNonEmptyString(username, 'E2E_TESTS_ROOT_USERNAME');
    assertNonEmptyString(password, 'E2E_TESTS_ROOT_PASSWORD');

    const response = await fetch(`${ getBaseUrl() }/admin-api/v1/publishing-api-tokens`, {
        method: 'POST',
        headers: {
            authorization: `Basic ${ btoa(`${ username }:${ password }`) }`,
            'content-type': JSON_API_CONTENT_TYPE,
        },
        body: JSON.stringify({
            data: {
                type: 'PublishingApiToken',
                attributes: { roles, timeToLiveSeconds, description },
            },
        }),
    });

    if (response.status !== 201) {
        throw new Error(
            `createPublishingApiToken: POST /admin-api/v1/publishing-api-tokens returned ${ response.status }, expected 201`,
        );
    }

    const { data } = await response.json();
    return { id: data.id, ...data.attributes };
}

/**
 * Revokes a Publishing API token through the protected admin-panel form.
 * @param {string} tokenId - SHA-256 digest identifying the token record.
 * @returns {Promise<void>}
 * @throws {Error} When the token list cannot be loaded or revocation does not redirect.
 */
export async function revokePublishingApiToken(tokenId) {
    assertNonEmptyString(tokenId, 'revokePublishingApiToken tokenId');

    const adminCookies = await loginRootAdmin();
    const tokenListUrl = `${ getBaseUrl() }/admin/publishing-api-tokens`;
    const formResponse = await fetch(tokenListUrl, {
        redirect: 'manual',
        headers: { cookie: adminCookies.cookieHeader() },
    });
    adminCookies.applyResponse(formResponse);

    if (formResponse.status !== 200) {
        throw new Error(
            `revokePublishingApiToken: GET /admin/publishing-api-tokens returned ${ formResponse.status }, expected 200`,
        );
    }

    const csrfToken = assertHtmlCsrfToken(await formResponse.text());
    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('token_id', tokenId);

    const revokeResponse = await fetch(`${ tokenListUrl }/revoke`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: adminCookies.cookieHeader() },
        body: form,
    });
    adminCookies.applyResponse(revokeResponse);

    if (revokeResponse.status !== 303) {
        throw new Error(
            `revokePublishingApiToken: POST /admin/publishing-api-tokens/revoke returned ${ revokeResponse.status }, expected 303`,
        );
    }
}

/**
 * Reads the Publishing API discovery resource.
 * @param {string} publishingToken - Publishing API bearer token.
 * @returns {Promise<{status: number, body: Object}>} Raw discovery response.
 */
export async function getDiscovery(publishingToken) {
    return await jsonRequest(publishingToken, 'GET', '');
}

/**
 * Reports which of the given object ids are already stored.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string[]} objectIds - Content addresses to check.
 * @returns {Promise<{status: number, body: Object}>} Raw ObjectStatus response.
 */
export async function getObjectStatus(publishingToken, objectIds) {
    return await jsonRequest(publishingToken, 'POST', 'objects/status', jsonApiDocument('ObjectStatus', { objectIds }));
}

/**
 * Uploads raw bytes to a specific object id, without verifying the address.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} objectId - Route object id, which may deliberately mismatch `body`.
 * @param {BodyInit} body - Raw payload bytes.
 * @returns {Promise<{status: number, body: Object}>} Raw Object response.
 */
export async function putObject(publishingToken, objectId, body) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/objects/${ objectId }`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${ publishingToken }` },
        body,
    });
    return { status: response.status, headers: response.headers, body: await readJsonBody(response) };
}

/**
 * Computes an object's content address and uploads it, failing loudly on any
 * status other than 200 (already present) or 201 (newly stored).
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} content - Object content.
 * @returns {Promise<{objectId: string, size: number, status: number}>} Stored object reference.
 * @throws {Error} When the upload does not succeed.
 */
export async function uploadObject(publishingToken, content) {
    const objectId = await hashBlob(content);
    const response = await putObject(publishingToken, objectId, content);
    if (response.status !== 200 && response.status !== 201) {
        throw new Error(
            `uploadObject: PUT /objects/${ objectId } returned ${ response.status }, expected 200 or 201: ${ JSON.stringify(response.body) }`,
        );
    }
    return { objectId, size: response.body.data.attributes.size, status: response.status };
}

/**
 * Creates and fully verifies a Release.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object} manifest - Release manifest.
 * @param {Object} [provenance] - Optional provenance metadata.
 * @returns {Promise<{status: number, body: Object}>} Raw Release response.
 */
export async function createRelease(publishingToken, manifest, provenance) {
    const attributes = provenance ? { manifest, provenance } : { manifest };
    return await jsonRequest(publishingToken, 'POST', 'releases', jsonApiDocument('Release', attributes));
}

/**
 * Creates a Release, failing loudly unless the store fully verifies it.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object} manifest - Release manifest.
 * @param {Object} [provenance] - Optional provenance metadata.
 * @returns {Promise<Object>} The created Release resource's `data`.
 * @throws {Error} When creation does not return 201.
 */
export async function createReleaseOrThrow(publishingToken, manifest, provenance) {
    const response = await createRelease(publishingToken, manifest, provenance);
    if (response.status !== 201) {
        throw new Error(
            `createReleaseOrThrow: POST /releases returned ${ response.status }, expected 201: ${ JSON.stringify(response.body) }`,
        );
    }
    return response.body.data;
}

/**
 * Verifies a Release without persisting it.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object} manifest - Release manifest referencing already-stored objects.
 * @param {Object} [provenance] - Optional provenance metadata.
 * @returns {Promise<{status: number, body: Object}>} Raw ReleaseValidation response.
 */
export async function validateRelease(publishingToken, manifest, provenance) {
    const attributes = provenance ? { manifest, provenance } : { manifest };
    return await jsonRequest(publishingToken, 'POST', 'releases/validation', jsonApiDocument('Release', attributes));
}

/**
 * Lists Release history.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object} [params] - Optional `cursor` and `limit` query parameters.
 * @returns {Promise<{status: number, body: Object}>} Raw Release collection response.
 */
export async function listReleases(publishingToken, params) {
    return await jsonRequest(publishingToken, 'GET', `releases${ queryString(params) }`);
}

/**
 * Gets one Release's metadata.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} releaseId - Release id to read.
 * @returns {Promise<{status: number, body: Object}>} Raw Release response.
 */
export async function getRelease(publishingToken, releaseId) {
    return await jsonRequest(publishingToken, 'GET', `releases/${ releaseId }`);
}

/**
 * Gets the complete manifest stored inside one Release's closure.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} releaseId - Release id to read.
 * @returns {Promise<{status: number, body: Object}>} Raw ReleaseManifest response.
 */
export async function getReleaseManifest(publishingToken, releaseId) {
    return await jsonRequest(publishingToken, 'GET', `releases/${ releaseId }/manifest`);
}

/**
 * Lists every registered build pointer.
 * @param {string} publishingToken - Publishing API bearer token.
 * @returns {Promise<{status: number, body: Object}>} Raw Build collection response.
 */
export async function listBuilds(publishingToken) {
    return await jsonRequest(publishingToken, 'GET', 'builds');
}

/**
 * Gets one build's authoritative pointer, running or not.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} buildId - Build id to read.
 * @returns {Promise<{status: number, headers: Headers, body: Object}>} Raw Build response, including its `ETag` header.
 */
export async function getBuild(publishingToken, buildId) {
    return await jsonRequest(publishingToken, 'GET', `builds/${ buildId }`);
}

/**
 * Assigns a Release to a build id using a mandatory pointer precondition.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} buildId - Build id to assign, matched against `data.id`.
 * @param {Object} assignment - Desired assignment.
 * @param {string} assignment.releaseId - Release id to assign.
 * @param {string} [assignment.reason] - Audit reason (`publish`, `rollback`, `carry-forward`, `restore`).
 * @param {string} [assignment.ifMatch] - Unquoted Release id the current pointer must equal.
 * @param {string} [assignment.ifNoneMatch] - Pass `'*'` to require the build be currently unassigned.
 * @returns {Promise<{status: number, headers: Headers, body: Object}>} Raw Build response.
 */
export async function putBuild(publishingToken, buildId, assignment) {
    const { releaseId, reason, ifMatch, ifNoneMatch } = assignment;
    const headers = {};
    if (ifMatch !== undefined) {
        headers['if-match'] = `"${ ifMatch }"`;
    }
    if (ifNoneMatch !== undefined) {
        headers['if-none-match'] = ifNoneMatch;
    }
    const attributes = reason ? { releaseId, reason } : { releaseId };
    return await jsonRequest(
        publishingToken,
        'PUT',
        `builds/${ buildId }`,
        jsonApiDocument('Build', attributes, buildId),
        headers,
    );
}

/**
 * Lists one build's activation history.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} buildId - Build id whose history to read.
 * @param {Object} [params] - Optional `cursor` and `limit` query parameters.
 * @returns {Promise<{status: number, body: Object}>} Raw Activation collection response.
 */
export async function listBuildActivations(publishingToken, buildId, params) {
    return await jsonRequest(publishingToken, 'GET', `builds/${ buildId }/activations${ queryString(params) }`);
}

function jsonApiDocument(type, attributes, id) {
    const data = id === undefined ? { type, attributes } : { type, id, attributes };
    return JSON.stringify({ data });
}

function queryString(params) {
    if (!params) {
        return '';
    }
    const search = new URLSearchParams(params).toString();
    return search ? `?${ search }` : '';
}

async function jsonRequest(publishingToken, method, path, body, extraHeaders) {
    const headers = { authorization: `Bearer ${ publishingToken }`, ...extraHeaders };
    if (body !== undefined) {
        headers['content-type'] = JSON_API_CONTENT_TYPE;
    }
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, { method, headers, body });
    return {
        status: response.status,
        headers: response.headers,
        body: await readJsonBody(response),
    };
}

async function readJsonBody(response) {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}
