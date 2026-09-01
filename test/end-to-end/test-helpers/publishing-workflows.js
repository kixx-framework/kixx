import process from 'node:process';
import { assertNonEmptyString } from 'kixx-assert';
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
 * Uploads an immutable static asset.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Asset pathname.
 * @param {BodyInit} content - Non-empty asset bytes.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed asset reference.
 * @throws {Error} When the API does not create the asset.
 */
export async function uploadStaticAsset(publishingToken, pathname, content) {
    return await uploadResource(publishingToken, `resources/static-asset/${ pathname }`, content);
}

/**
 * Uploads the global partial-template bundle.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object[]} bundle - Partial templates with `id` and `source` fields.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed bundle reference.
 * @throws {Error} When the API does not create the bundle.
 */
export async function uploadGlobalTemplatePartials(publishingToken, bundle) {
    return await uploadJsonApiResource(publishingToken, 'resources/global-template-partials', 'GlobalTemplatePartials', { bundle });
}

/**
 * Uploads the base-template bundle.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object[]} bundle - Base templates with `id` and `source` fields.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed bundle reference.
 * @throws {Error} When the API does not create the bundle.
 */
export async function uploadBaseTemplates(publishingToken, bundle) {
    return await uploadJsonApiResource(publishingToken, 'resources/base-templates', 'BaseTemplates', { bundle });
}

/**
 * Uploads a page metadata document.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Canonical page pathname.
 * @param {Object} attributes - Page metadata attributes.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed metadata reference.
 * @throws {Error} When the API does not create the metadata document.
 */
export async function uploadPageMetadata(publishingToken, pathname, attributes) {
    return await uploadJsonApiResource(publishingToken, `resources/page-metadata/${ pathname }`, 'PageMetadata', attributes);
}

/**
 * Uploads page include source files.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Canonical page pathname.
 * @param {Object<string, string>} bundle - Include pathname-to-source mapping.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed includes reference.
 * @throws {Error} When the API does not create the include bundle.
 */
export async function uploadPageIncludes(publishingToken, pathname, bundle) {
    return await uploadJsonApiResource(publishingToken, `resources/page-includes/${ pathname }`, 'PageIncludes', { bundle });
}

/**
 * Uploads page partial templates.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Canonical page pathname.
 * @param {Object[]} bundle - Partial templates with `id` and `source` fields.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed partials reference.
 * @throws {Error} When the API does not create the partial bundle.
 */
export async function uploadPagePartials(publishingToken, pathname, bundle) {
    return await uploadJsonApiResource(publishingToken, `resources/page-partials/${ pathname }`, 'PagePartials', { bundle });
}

/**
 * Uploads a plain-text page template.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Canonical page pathname.
 * @param {string} source - Template source.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed template reference.
 * @throws {Error} When the API does not create the template.
 */
export async function uploadPageTemplate(publishingToken, pathname, source) {
    return await uploadResource(publishingToken, `resources/page-templates/${ pathname }`, source, 'text/plain');
}

/**
 * Uploads email templates, partials, and includes.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {string} pathname - Email pathname.
 * @param {Object} attributes - Email asset attributes.
 * @returns {Promise<{hash: string, size: number}>} Content-addressed email asset reference.
 * @throws {Error} When the API does not create the email assets.
 */
export async function uploadEmailAssets(publishingToken, pathname, attributes) {
    return await uploadJsonApiResource(publishingToken, `resources/emails/${ pathname }`, 'EmailAssets', attributes);
}

/**
 * Reads the running deploy's currently active Build through the Publishing API.
 * @param {string} publishingToken - Publishing API bearer token.
 * @returns {Promise<{id: string, rootHash: string}>} Active build id and its assigned closure root hash.
 * @throws {Error} When the API does not report an active Build.
 */
export async function getActiveBuild(publishingToken) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/build`, {
        headers: { authorization: `Bearer ${ publishingToken }` },
    });

    if (response.status !== 200) {
        throw new Error(
            `getActiveBuild: GET /publishing-api/v1/build returned ${ response.status }, expected 200`,
        );
    }

    const { data } = await response.json();
    return { id: data.id, rootHash: data.attributes.rootHash };
}

/**
 * Conditionally points the running deploy's build at an already-published
 * closure. Never publishes new content: `rootHash` must already name a saved
 * closure, and the assignment only takes effect while the build's current
 * pointer still equals `expectedRootHash`.
 * @param {string} publishingToken - Publishing API bearer token.
 * @param {Object} assignment - Desired assignment.
 * @param {string} assignment.buildId - The running deploy's own build id, matched against `data.id`.
 * @param {string} assignment.rootHash - Root hash of a previously published closure.
 * @param {string} assignment.expectedRootHash - Root hash the caller last observed as the current pointer.
 * @returns {Promise<{id: string, rootHash: string}>} The resulting active build id and root hash.
 * @throws {Error} When the API does not confirm the assignment, including on a
 *   stale `expectedRootHash` (409) — callers that call this from an `after`
 *   restoration hook want that failure to surface loudly rather than being
 *   silently retried over a pointer someone else has since moved.
 */
export async function putActiveBuild(publishingToken, assignment) {
    const { buildId, rootHash, expectedRootHash } = assignment;

    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/build`, {
        method: 'PUT',
        headers: {
            authorization: `Bearer ${ publishingToken }`,
            'content-type': JSON_API_CONTENT_TYPE,
        },
        body: JSON.stringify({
            data: {
                type: 'Build',
                id: buildId,
                attributes: { rootHash, expectedRootHash },
            },
        }),
    });

    if (response.status !== 200) {
        const body = await response.text();
        throw new Error(
            `putActiveBuild: PUT /publishing-api/v1/build returned ${ response.status }, expected 200: ${ body }`,
        );
    }

    const { data } = await response.json();
    return { id: data.id, rootHash: data.attributes.rootHash };
}

async function uploadJsonApiResource(publishingToken, path, type, attributes) {
    return await uploadResource(
        publishingToken,
        path,
        JSON.stringify({ data: { type, attributes } }),
        JSON_API_CONTENT_TYPE,
    );
}

async function uploadResource(publishingToken, path, body, contentType) {
    const headers = { authorization: `Bearer ${ publishingToken }` };
    if (contentType) {
        headers['content-type'] = contentType;
    }

    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, {
        method: 'PUT',
        headers,
        body,
    });

    if (response.status !== 201) {
        throw new Error(
            `uploadResource: PUT /publishing-api/v1/${ path } returned ${ response.status }, expected 201`,
        );
    }

    const { data } = await response.json();
    return { hash: data.attributes.hash, size: data.attributes.size };
}
