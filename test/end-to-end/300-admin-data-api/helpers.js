import { parseHTML } from 'parse-html-dom';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { assertHtmlCsrfToken } from '../test-helpers/html.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


export const JSON_API = 'application/vnd.api+json';
export const API_PATHNAME = '/admin-data-api/v1';
export const TOKEN_PATTERN = /^kxadt_[0-9a-f]{64}$/u;

const TOKEN_LIST_PATHNAME = '/admin/admin-data-api-tokens';


/**
 * @typedef {Object} AdminDataApiToken
 * @property {string} token - One-time plaintext bearer token read from the creation page.
 * @property {string} id - SHA-256 hex digest of the token; the token record id.
 * @property {string} html - The creation page that displayed the token.
 */

/**
 * @typedef {Object} ApiResult
 * @property {Response} response - Raw response, body already consumed.
 * @property {number} status - HTTP status code.
 * @property {Object|null} document - Parsed JSON:API document, or null for an empty or non-JSON body.
 * @property {string} text - Raw response body.
 */

/**
 * Loads the data token page and returns its HTML and CSRF token.
 * @param {CookieJar} cookies - Authenticated admin cookie jar.
 * @returns {Promise<{html: string, csrfToken: string}>}
 */
export async function openTokenPage(cookies) {
    const response = await fetch(`${ getBaseUrl() }${ TOKEN_LIST_PATHNAME }`, {
        redirect: 'manual',
        headers: { cookie: cookies.cookieHeader() },
    });
    cookies.applyResponse(response);
    assertEqual(200, response.status, `GET ${ TOKEN_LIST_PATHNAME } status`);

    const html = await response.text();
    return { html, csrfToken: assertHtmlCsrfToken(html) };
}

/**
 * Submits the admin-panel token creation form without asserting the outcome.
 * @param {CookieJar} cookies - Authenticated admin cookie jar.
 * @param {Object} options
 * @param {string[]} options.grants - `"<Collection>:<action>"` checkbox values.
 * @param {string} [options.description] - Operator-facing description.
 * @param {string|null} [options.csrfToken] - Form CSRF token; null omits the field, undefined loads a fresh one.
 * @returns {Promise<{status: number, html: string}>}
 */
export async function submitTokenForm(cookies, options) {
    const { grants, description = 'e2e admin data API token' } = options;
    let { csrfToken } = options;

    if (csrfToken === undefined) {
        ({ csrfToken } = await openTokenPage(cookies));
    }

    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    form.append('description', description);
    for (const grant of grants) {
        form.append('grants', grant);
    }
    form.append('time_to_live_seconds', '3600');

    const response = await fetch(`${ getBaseUrl() }${ TOKEN_LIST_PATHNAME }`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookies.cookieHeader() },
        body: form,
    });
    cookies.applyResponse(response);

    return { status: response.status, html: await response.text() };
}

/**
 * Creates a data token through the admin panel and reads its one-time secret.
 * @param {CookieJar} cookies - Cookie jar for an admin allowed to manage data tokens.
 * @param {string[]} grants - `"<Collection>:<action>"` checkbox values.
 * @returns {Promise<AdminDataApiToken>}
 */
export async function createDataToken(cookies, grants) {
    const { status, html } = await submitTokenForm(cookies, { grants });
    assertEqual(200, status, 'create data token status');

    const document = parseHTML(html);
    const field = document.getElementsByTagName('input')
        .find((element) => element.getAttribute('id') === 'new-token');
    assert(field, 'one-time token field');

    const token = field.getAttribute('value');
    assertMatches(TOKEN_PATTERN, token, 'minted data token');

    return { token, id: await sha256Hex(token), html };
}

/**
 * Revokes a data token through the CSRF-protected admin-panel form.
 * @param {CookieJar} cookies - Cookie jar for an admin allowed to manage data tokens.
 * @param {string} tokenId - Token record id.
 * @returns {Promise<number>} Response status; a successful revoke redirects with 303.
 */
export async function revokeDataToken(cookies, tokenId) {
    const { csrfToken } = await openTokenPage(cookies);

    const form = new FormData();
    form.append('csrf_token', csrfToken);
    form.append('token_id', tokenId);

    const response = await fetch(`${ getBaseUrl() }${ TOKEN_LIST_PATHNAME }/revoke`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: cookies.cookieHeader() },
        body: form,
    });
    cookies.applyResponse(response);
    await response.arrayBuffer();

    return response.status;
}

/**
 * Sends one Admin Data API request.
 * @param {string|null} token - Bearer token, or null for an unauthenticated request.
 * @param {string} method - HTTP method.
 * @param {string} pathname - Path and query below `/admin-data-api/v1`, or a complete URL.
 * @param {Object} [options]
 * @param {Object} [options.body] - JSON:API document; sent with the JSON:API Content-Type.
 * @param {Object<string, string>} [options.headers] - Additional request headers.
 * @returns {Promise<ApiResult>}
 */
export async function apiRequest(token, method, pathname, options) {
    const { body, headers: extraHeaders } = options ?? {};

    const headers = Object.assign({ accept: JSON_API }, extraHeaders);
    if (token) {
        headers.authorization = `Bearer ${ token }`;
    }
    if (body !== undefined) {
        headers['content-type'] = JSON_API;
    }

    const url = /^https?:/u.test(pathname) ? pathname : `${ getBaseUrl() }${ API_PATHNAME }${ pathname }`;
    const response = await fetch(url, {
        method,
        redirect: 'manual',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let document = null;
    try {
        document = text ? JSON.parse(text) : null;
    } catch {
        document = null;
    }

    return { response, status: response.status, document, text };
}

/**
 * Builds a create document for a File that references existing content.
 * @param {Object} content - Complete content reference.
 * @param {Object} [attributes] - Attribute overrides.
 * @returns {Object}
 */
export function fileCreateDocument(content, attributes) {
    return {
        data: {
            type: 'files',
            attributes: Object.assign({
                title: `e2e admin data ${ crypto.randomUUID().slice(0, 8) }`,
                description: null,
                isPublished: false,
                content,
            }, attributes),
        },
    };
}

/**
 * Builds a PATCH document carrying the observed version.
 * @param {string} id - Resource id.
 * @param {number} version - Version the client last read.
 * @param {Object} attributes - Attributes to replace.
 * @returns {Object}
 */
export function filePatchDocument(id, version, attributes) {
    return { data: { type: 'files', id, attributes, meta: { version } } };
}

/**
 * Tracks File records a test creates through the API and deletes the ones
 * still present. Cleanup reads each record's current version first, so it
 * never relies on a version a test may have advanced, and it tolerates 404 so
 * a test that already deleted its record does not fail the after hook. It
 * removes records only; content bytes belong to the fixtures that uploaded them.
 */
export class ApiFileFixtures {

    #token;
    #ids = new Set();

    /**
     * @param {string} token - Data token granted `get` and `delete` on File.
     */
    constructor(token) {
        assertMatches(TOKEN_PATTERN, token, 'ApiFileFixtures token');
        this.#token = token;
    }

    /**
     * @param {string|undefined} id - Id of a record this test created.
     */
    track(id) {
        if (id) {
            this.#ids.add(id);
        }
    }

    /**
     * Creates and tracks one File record.
     * @param {Object} document - Create document.
     * @returns {Promise<Object>} The created resource object.
     */
    async create(document) {
        const result = await apiRequest(this.#token, 'POST', '/files', { body: document });
        assertEqual(201, result.status, `create File record (${ result.text.slice(0, 200) })`);
        this.track(result.document.data.id);
        return result.document.data;
    }

    /**
     * @returns {Promise<void>}
     * @throws {Error} When any tracked record could not be removed.
     */
    async cleanup() {
        const failures = [];

        for (const id of this.#ids) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.#remove(id);
                this.#ids.delete(id);
            } catch (error) {
                failures.push(`${ id }: ${ error.message }`);
            }
        }

        if (failures.length > 0) {
            throw new Error(`Admin data File cleanup failed for ${ failures.join('; ') }`);
        }
    }

    async #remove(id) {
        const current = await apiRequest(this.#token, 'GET', `/files/${ id }`);
        if (current.status === 404) {
            return;
        }
        assertEqual(200, current.status, `cleanup read ${ id }`);

        const deleted = await apiRequest(this.#token, 'DELETE', `/files/${ id }`, {
            headers: { 'kixx-expected-version': String(current.document.data.meta.version) },
        });
        if (deleted.status !== 404) {
            assertEqual(204, deleted.status, `cleanup delete ${ id }`);
        }
    }
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
