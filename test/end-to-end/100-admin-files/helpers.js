import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertEqual, assertNonEmptyString, isString } from 'kixx-assert';
import CookieJar from '../test-helpers/cookies.js';
import { getBaseUrl } from '../test-helpers/target-url.js';


export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Listing rows carry exactly one state-appropriate publication form, so its
// action is the one stable, parseable handle on each row's id and state.
const ROW_ACTION_PATTERN = /^\/admin\/files\/([0-9a-f-]{36})\/(publish|unpublish)$/u;


/**
 * @typedef {Object} UploadPage
 * @property {string} csrfToken - Token the upload queue sends in `x-kixx-csrf-token`.
 * @property {string} uploadPathname - Upload endpoint rendered by the page.
 * @property {number} maxUploadBytes - Configured per-file limit rendered by the page.
 */

/**
 * @typedef {Object} JsonResult
 * @property {Response} response - Raw response, body already consumed.
 * @property {number} status - HTTP status code.
 * @property {Object|null} json - Parsed JSON body, or null when the body is not JSON.
 * @property {string} text - Raw response body.
 */

/**
 * Loads the batch upload page and reads the values its upload queue uses.
 *
 * The target's configured limit comes from the rendered page rather than a
 * local config file, so the same test runs unchanged against any platform.
 *
 * @param {CookieJar} cookies - Authenticated admin cookie jar.
 * @returns {Promise<UploadPage>}
 */
export async function openUploadPage(cookies) {
    const response = await fetch(`${ getBaseUrl() }/admin/files/new`, {
        redirect: 'manual',
        headers: { cookie: cookies.cookieHeader() },
    });
    cookies.applyResponse(response);
    assertEqual(200, response.status, 'GET /admin/files/new status');

    const document = new FastHTMLParser(await response.text());
    const queue = document.getElementsByTagName('div')
        .find((element) => element.getAttribute('data-js-behavior') === 'file-upload-queue');
    assert(queue, 'file-upload-queue container');

    const csrfToken = queue.getAttribute('data-csrf-token');
    const uploadPathname = queue.getAttribute('data-upload-url');
    const maxUploadBytes = Number(queue.getAttribute('data-max-upload-bytes'));
    assertNonEmptyString(csrfToken, 'upload page CSRF token');
    assertNonEmptyString(uploadPathname, 'upload page upload URL');
    assert(Number.isSafeInteger(maxUploadBytes) && maxUploadBytes > 0, 'upload page max upload bytes');

    return { csrfToken, uploadPathname, maxUploadBytes };
}

/**
 * Sends one raw upload the way the browser upload queue does.
 * @param {CookieJar|null} cookies - Admin cookie jar, or null for an anonymous request.
 * @param {Object} options
 * @param {string|null} options.csrfToken - Header CSRF token; null omits the header.
 * @param {string} options.filename - Unencoded filename; URI-encoded into `x-file-name`.
 * @param {Uint8Array|Blob|string} options.body - Raw file bytes; a file-backed Blob streams without buffering.
 * @param {number|string|null} [options.declaredSize] - `x-file-size`; defaults to the body byte length, null omits it.
 * @param {string} [options.contentType='application/octet-stream'] - Browser-claimed MIME type.
 * @param {string} [options.fileId] - Existing file to replace instead of creating a new one.
 * @param {string[]} [options.cookieNames] - Sends only these cookies from the jar.
 * @param {Object<string, string>} [options.headers] - Additional request headers.
 * @returns {Promise<JsonResult>}
 */
export async function sendUpload(cookies, options) {
    const {
        csrfToken,
        filename,
        body,
        contentType = 'application/octet-stream',
        fileId = null,
        cookieNames = null,
    } = options ?? {};

    const bytes = isString(body) ? new TextEncoder().encode(body) : body;
    const bodyLength = bytes instanceof Blob ? bytes.size : bytes.byteLength;
    const declaredSize = Object.hasOwn(options, 'declaredSize') ? options.declaredSize : bodyLength;
    const pathname = fileId ? `/admin/files/${ fileId }/replace` : '/admin/files/upload';

    const headers = Object.assign({
        'content-type': contentType,
        'x-file-name': encodeURIComponent(filename),
    }, options.headers);
    if (declaredSize !== null) {
        headers['x-file-size'] = String(declaredSize);
    }
    if (csrfToken) {
        headers['x-kixx-csrf-token'] = csrfToken;
    }
    if (cookies) {
        headers.cookie = cookies.cookieHeader(cookieNames);
    }

    const response = await fetch(`${ getBaseUrl() }${ pathname }`, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: bytes,
    });
    cookies?.applyResponse(response);

    return await readJsonResult(response);
}

/**
 * Uploads a file and asserts the documented creation contract.
 * @param {CookieJar} cookies - Authenticated admin cookie jar.
 * @param {string} csrfToken - Header CSRF token from openUploadPage().
 * @param {string} filename - Unencoded filename.
 * @param {Uint8Array|string} body - Raw file bytes.
 * @returns {Promise<Object>} The created file document from the response.
 */
export async function uploadFile(cookies, csrfToken, filename, body) {
    const result = await sendUpload(cookies, { csrfToken, filename, body });
    assertEqual(201, result.status, `upload ${ filename } status (${ result.text.slice(0, 200) })`);
    assert(UUID_PATTERN.test(result.json?.file?.id), 'uploaded file id');

    return result.json.file;
}

/**
 * Submits a CSRF-protected file action form.
 * @param {CookieJar} cookies - Authenticated admin cookie jar.
 * @param {string} csrfToken - Form CSRF token; empty omits the field.
 * @param {string} fileId - Target file id.
 * @param {string} action - `metadata`, `publish`, `unpublish`, or `delete`.
 * @param {Object} [options]
 * @param {Object<string, string>} [options.fields] - Additional form fields.
 * @param {boolean} [options.isPartial=false] - Sends `kixx-partial` like a JavaScript row action.
 * @returns {Promise<JsonResult & {location: string|null}>}
 */
export async function postFileAction(cookies, csrfToken, fileId, action, options) {
    const { fields = {}, isPartial = false } = options ?? {};

    const form = new FormData();
    if (csrfToken) {
        form.append('csrf_token', csrfToken);
    }
    for (const [ name, value ] of Object.entries(fields)) {
        form.append(name, value);
    }

    const headers = { cookie: cookies.cookieHeader() };
    if (isPartial) {
        headers['kixx-partial'] = 'row';
    }

    const response = await fetch(`${ getBaseUrl() }/admin/files/${ fileId }/${ action }`, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: form,
    });
    cookies.applyResponse(response);

    const result = await readJsonResult(response);
    return Object.assign(result, { location: response.headers.get('location') });
}

/**
 * Fetches a URL with the admin session, reading the full body.
 * @param {CookieJar|null} cookies - Cookie jar, or null for an anonymous request.
 * @param {string} pathname - Root-relative pathname and query.
 * @param {RequestInit} [init] - Additional fetch options.
 * @returns {Promise<{response: Response, status: number, bytes: Uint8Array, text: string}>}
 */
export async function fetchPathname(cookies, pathname, init) {
    const headers = Object.assign({}, init?.headers);
    if (cookies) {
        headers.cookie = cookies.cookieHeader();
    }

    const response = await fetch(`${ getBaseUrl() }${ pathname }`, Object.assign({}, init, {
        redirect: 'manual',
        headers,
    }));
    cookies?.applyResponse(response);

    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
        response,
        status: response.status,
        bytes,
        text: new TextDecoder().decode(bytes),
    };
}

/**
 * Reads one listing page's rows in rendered order.
 * @param {string} html - Rendered `/admin/files` page.
 * @returns {Array<{id: string, isPublished: boolean}>}
 */
export function getListingRows(html) {
    const document = new FastHTMLParser(html);
    const rows = [];

    for (const form of document.getElementsByTagName('form')) {
        const match = ROW_ACTION_PATTERN.exec(form.getAttribute('action') || '');
        if (match) {
            rows.push({ id: match[1], isPublished: match[2] === 'unpublish' });
        }
    }

    return rows;
}

/**
 * Reads a pagination link by its visible label.
 * @param {string} html - Rendered `/admin/files` page.
 * @param {string} label - `Next page` or `Previous page`.
 * @returns {string|null} Root-relative href, or null when absent.
 */
export function getPaginationHref(html, label) {
    const document = new FastHTMLParser(html);
    const link = document.getElementsByTagName('a')
        .find((element) => element.textContent.trim() === label);

    return link ? decodeHtmlAttribute(link.getAttribute('href')) : null;
}

/**
 * Tracks files a test file creates and deletes whatever is still present.
 *
 * Cleanup unpublishes before deleting because deletion requires an
 * unpublished file, and it tolerates a 404 so a test that already deleted its
 * fixture does not fail the after hook. It never touches ids it did not create.
 */
export class FileFixtures {

    #cookies;
    #csrfToken;
    #ids = new Set();

    /**
     * @param {CookieJar} cookies - Admin cookie jar able to delete files.
     * @param {string} csrfToken - Form CSRF token for that jar.
     */
    constructor(cookies, csrfToken) {
        assert(cookies instanceof CookieJar, 'FileFixtures cookies');
        assertNonEmptyString(csrfToken, 'FileFixtures csrfToken');
        this.#cookies = cookies;
        this.#csrfToken = csrfToken;
    }

    /**
     * A failed upload has no id; the test's own assertions report that failure.
     * @param {string|undefined} fileId - Id of a file this test created.
     */
    track(fileId) {
        if (fileId) {
            this.#ids.add(fileId);
        }
    }

    /**
     * Uploads and tracks one file.
     * @param {string} filename - Unencoded filename.
     * @param {Uint8Array|string} body - Raw file bytes.
     * @returns {Promise<Object>} The created file document.
     */
    async upload(filename, body) {
        const file = await uploadFile(this.#cookies, this.#csrfToken, filename, body);
        this.track(file.id);
        return file;
    }

    /**
     * Deletes every tracked file that still exists, a few at a time.
     * @returns {Promise<void>}
     * @throws {Error} When any tracked file could not be removed.
     */
    async cleanup() {
        const ids = Array.from(this.#ids);
        const failures = [];

        // Small batches keep a large fixture set inside the hook timeout
        // without flooding a remote target with simultaneous requests.
        for (let index = 0; index < ids.length; index += 5) {
            const batch = ids.slice(index, index + 5);
            // eslint-disable-next-line no-await-in-loop
            const results = await Promise.allSettled(batch.map((id) => this.#remove(id)));
            results.forEach((result, offset) => {
                if (result.status === 'rejected') {
                    failures.push(`${ batch[offset] }: ${ result.reason?.message }`);
                } else {
                    this.#ids.delete(batch[offset]);
                }
            });
        }

        if (failures.length > 0) {
            throw new Error(`File fixture cleanup failed for ${ failures.join('; ') }`);
        }
    }

    async #remove(fileId) {
        const unpublished = await postFileAction(this.#cookies, this.#csrfToken, fileId, 'unpublish', { isPartial: true });
        if (unpublished.status === 404) {
            return;
        }
        assertEqual(200, unpublished.status, `cleanup unpublish ${ fileId }`);

        const deleted = await postFileAction(this.#cookies, this.#csrfToken, fileId, 'delete', {
            fields: { confirm_delete: 'yes' },
            isPartial: true,
        });
        if (deleted.status !== 404) {
            assertEqual(200, deleted.status, `cleanup delete ${ fileId }`);
        }
    }
}

/**
 * Creates a unique filename so fixtures are recognizable and never collide.
 * @param {string} label - Short fixture label.
 * @param {string} extension - Extension without the dot.
 * @returns {string}
 */
export function createFixtureFilename(label, extension) {
    return `e2e-${ label }-${ crypto.randomUUID().slice(0, 8) }.${ extension }`;
}

async function readJsonResult(response) {
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }

    return { response, status: response.status, json, text };
}

function decodeHtmlAttribute(value) {
    return value ? value.replaceAll('&amp;', '&') : value;
}
