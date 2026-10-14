/**
 * Cloudflare account API client used by the `cloudflare` commands.
 * @module cloudflare-api-client
 */

import {
    assert,
    assertNonEmptyString,
    isBoolean,
    isFunction,
    isPlainObject,
    isString,
    isUndefined,
} from '../vendor/kixx-assert/mod.js';
import CloudflareApiError from './cloudflare-api-error.js';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

// Cloudflare answers a rejected token and a token lacking a permission with
// the same generic error code (10000), so the status is the only signal a
// failed request gives us that the token is worth verifying.
const AUTH_STATUSES = [ 401, 403 ];

// The only token status Cloudflare reports for a token that still works.
// A token may also verify as "disabled" or "expired".
const ACTIVE_TOKEN_STATUS = 'active';

/**
 * @typedef {Object} TokenVerification
 * @property {string} status - `valid` when Cloudflare accepts the token,
 *     `invalid` when it rejects it, and `unknown` when Cloudflare could not
 *     be asked or gave an answer unrelated to the token.
 * @property {?string} detail - Cloudflare's own token status, such as
 *     `active`, `disabled`, or `expired`, when it reports one.
 * @property {Array<Object>} errors - Cloudflare error array from the
 *     verification response, empty when there was none.
 */

/**
 * Sends authenticated requests to the Cloudflare Workers, KV, D1, and R2 APIs.
 * Only reads and Worker writes are offered: devkit never creates storage
 * resources or writes secrets.
 */
export default class CloudflareAPIClient {

    #accountId;
    #apiToken;
    #fetch;

    /**
     * @param {Object} options - Client configuration
     * @param {string} options.accountId - Cloudflare account identifier
     * @param {string} options.apiToken - Cloudflare API token sent as a Bearer token
     * @param {typeof fetch} [options.fetch] - Fetch implementation, defaulting to the global
     */
    constructor(options) {
        const {
            accountId,
            apiToken,
            fetch: fetchImpl = globalThis.fetch,
        } = options ?? {};

        assertNonEmptyString(accountId, 'CloudflareAPIClient() requires an accountId');
        assertNonEmptyString(apiToken, 'CloudflareAPIClient() requires an apiToken');
        assert(isFunction(fetchImpl), 'CloudflareAPIClient() requires a fetch function');

        this.#accountId = accountId;
        this.#apiToken = apiToken;
        this.#fetch = fetchImpl;
    }

    /**
     * Asks Cloudflare whether the configured API token is usable at all.
     *
     * This is the only way to separate "the token is dead" from "the token
     * works but is not allowed to do this". Reports a verdict instead of
     * throwing, because it explains a failure that has already happened; an
     * unreachable Cloudflare yields `unknown` rather than masking that failure.
     *
     * @returns {Promise<TokenVerification>} What Cloudflare says about the token
     */
    async verifyToken() {
        const url = new URL(`${ BASE_URL }/user/tokens/verify`);
        let res;

        try {
            res = await this.#fetch(url, {
                method: 'GET',
                headers: { authorization: `Bearer ${ this.#apiToken }` },
            });
        } catch {
            return { status: 'unknown', detail: null, errors: [] };
        }

        const body = await readJsonBody(res);

        if (res.ok && body?.success) {
            const detail = body.result?.status ?? null;
            const isUsable = detail === null || detail === ACTIVE_TOKEN_STATUS;

            return {
                status: isUsable ? 'valid' : 'invalid',
                detail,
                errors: [],
            };
        }

        const errors = this.#redact(Array.isArray(body?.errors) ? body.errors : []);

        // Only an auth status means Cloudflare looked at the token and
        // refused it. A 5xx or a proxy error page says nothing about it.
        if (AUTH_STATUSES.includes(res.status)) {
            return { status: 'invalid', detail: null, errors };
        }

        return { status: 'unknown', detail: null, errors };
    }

    /**
     * Creates a Worker from the supplied configuration.
     * @param {Object} payload - Worker configuration accepted by Cloudflare
     * @param {string} payload.name - Worker name
     * @returns {Promise<Object>} Created Worker result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async createWorker(payload) {
        assert(isPlainObject(payload), 'CloudflareAPIClient#createWorker() requires a payload');
        assertNonEmptyString(payload.name, 'CloudflareAPIClient#createWorker() requires a payload.name');

        const url = this.#accountUrl('workers/workers');

        return await this.#fetchResult(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    /**
     * Retrieves Worker metadata, including its Durable Object references.
     * @param {string} workerId - Worker ID or name
     * @returns {Promise<Object>} Unwrapped Cloudflare Worker result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async getWorker(workerId) {
        assertNonEmptyString(workerId, 'CloudflareAPIClient#getWorker() requires a workerId');

        return await this.#fetchResult(this.#accountUrl(`workers/workers/${ workerId }`), { method: 'GET' });
    }

    /**
     * Replaces a Worker's configuration.
     * @param {string} workerId - Worker ID or name
     * @param {Object} payload - Replacement Worker configuration accepted by Cloudflare
     * @returns {Promise<Object>} Updated Worker result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async updateWorker(workerId, payload) {
        assertNonEmptyString(workerId, 'CloudflareAPIClient#updateWorker() requires a workerId');
        assert(isPlainObject(payload), 'CloudflareAPIClient#updateWorker() requires a payload');

        return await this.#fetchResult(this.#accountUrl(`workers/workers/${ workerId }`), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    /**
     * Lists a page of versions for a Worker, newest first.
     * @param {string} workerId - Worker ID or name
     * @param {Object} [options] - Pagination options
     * @param {number} [options.page=1] - Page number to fetch
     * @param {number} [options.per_page=3] - Number of versions per page
     * @returns {Promise<Array<Object>>} Unwrapped Worker version results
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async listWorkerVersions(workerId, options) {
        assertNonEmptyString(workerId, 'CloudflareAPIClient#listWorkerVersions() requires a workerId');
        assert(
            isUndefined(options) || isPlainObject(options),
            'CloudflareAPIClient#listWorkerVersions() options must be an object',
        );

        const { page = 1, per_page = 3 } = options ?? {};

        assert(
            Number.isInteger(page) && page > 0,
            'CloudflareAPIClient#listWorkerVersions() options.page must be a positive integer',
        );
        assert(
            Number.isInteger(per_page) && per_page > 0,
            'CloudflareAPIClient#listWorkerVersions() options.per_page must be a positive integer',
        );

        const url = this.#accountUrl(`workers/workers/${ workerId }/versions`);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(per_page));

        return await this.#fetchResult(url, { method: 'GET' });
    }

    /**
     * Retrieves one version of a Worker.
     * @see https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get
     * @param {string} workerId - Worker ID or name
     * @param {string} versionId - Version identifier
     * @returns {Promise<Object>} Unwrapped Worker version result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async getWorkerVersion(workerId, versionId) {
        assertNonEmptyString(workerId, 'CloudflareAPIClient#getWorkerVersion() requires a workerId');
        assertNonEmptyString(versionId, 'CloudflareAPIClient#getWorkerVersion() requires a versionId');

        const url = this.#accountUrl(`workers/workers/${ workerId }/versions/${ versionId }`);

        return await this.#fetchResult(url, { method: 'GET' });
    }

    /**
     * Creates a Worker version from modules, bindings, and runtime metadata.
     * @see https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create
     * @param {string} workerName - Worker name
     * @param {Object} version - Version payload accepted by Cloudflare
     * @param {Object} [options] - Request options
     * @param {boolean} [options.deploy] - Whether to route all traffic to the new version
     * @param {boolean} [options.strictBindingsInheritance] - Reject unresolved inherited bindings
     * @returns {Promise<Object>} Created Worker version result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async createWorkerVersion(workerName, version, options) {
        assertNonEmptyString(workerName, 'CloudflareAPIClient#createWorkerVersion() requires a workerName');
        assert(isPlainObject(version), 'CloudflareAPIClient#createWorkerVersion() requires a version');
        assert(
            isUndefined(options) || isPlainObject(options),
            'CloudflareAPIClient#createWorkerVersion() options must be an object',
        );
        assert(
            isUndefined(options?.deploy) || isBoolean(options.deploy),
            'CloudflareAPIClient#createWorkerVersion() options.deploy must be a boolean',
        );
        assert(
            isUndefined(options?.strictBindingsInheritance) || isBoolean(options.strictBindingsInheritance),
            'CloudflareAPIClient#createWorkerVersion() options.strictBindingsInheritance must be a boolean',
        );

        const url = this.#accountUrl(`workers/workers/${ workerName }/versions`);

        if (!isUndefined(options?.deploy)) {
            url.searchParams.set('deploy', String(options.deploy));
        }
        if (options?.strictBindingsInheritance) {
            url.searchParams.set('bindings_inherit', 'strict');
        }

        return await this.#fetchResult(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(version),
        });
    }

    /**
     * Creates a deployment for existing Worker versions. Never sends
     * Cloudflare's `force` parameter: a refused deployment is surfaced to the
     * operator rather than overridden.
     * @see https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create
     * @param {string} workerName - Worker name
     * @param {Object} deployment - Deployment strategy and versions accepted by Cloudflare
     * @returns {Promise<Object>} Created deployment result
     * @throws {CloudflareApiError} When Cloudflare rejects the request
     */
    async createDeployment(workerName, deployment) {
        assertNonEmptyString(workerName, 'CloudflareAPIClient#createDeployment() requires a workerName');
        assert(isPlainObject(deployment), 'CloudflareAPIClient#createDeployment() requires a deployment');

        return await this.#fetchResult(this.#accountUrl(`workers/scripts/${ workerName }/deployments`), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(deployment),
        });
    }

    /**
     * Retrieves a Workers KV namespace.
     * @param {string} namespaceId - Workers KV namespace identifier
     * @returns {Promise<Object>} Unwrapped Workers KV namespace result
     * @throws {CloudflareApiError} When Cloudflare rejects the request; status 404 when it does not exist
     */
    async getKVNamespace(namespaceId) {
        assertNonEmptyString(namespaceId, 'CloudflareAPIClient#getKVNamespace() requires a namespaceId');

        return await this.#fetchResult(this.#accountUrl(`storage/kv/namespaces/${ namespaceId }`), { method: 'GET' });
    }

    /**
     * Retrieves a D1 database.
     * @param {string} databaseId - D1 database identifier
     * @returns {Promise<Object>} Unwrapped D1 database result
     * @throws {CloudflareApiError} When Cloudflare rejects the request; status 404 when it does not exist
     */
    async getD1Database(databaseId) {
        assertNonEmptyString(databaseId, 'CloudflareAPIClient#getD1Database() requires a databaseId');

        return await this.#fetchResult(this.#accountUrl(`d1/database/${ databaseId }`), { method: 'GET' });
    }

    /**
     * Retrieves an R2 bucket. Bucket names are unique only within a
     * jurisdiction, so a bucket in `eu` is not found without naming it.
     * @param {string} bucketName - R2 bucket name
     * @param {Object} [options] - Lookup options
     * @param {string} [options.jurisdiction] - Jurisdiction to look in, such as `eu`
     * @returns {Promise<Object>} Unwrapped R2 bucket result
     * @throws {CloudflareApiError} When Cloudflare rejects the request; status 404 when it does not exist
     */
    async getR2Bucket(bucketName, options) {
        assertNonEmptyString(bucketName, 'CloudflareAPIClient#getR2Bucket() requires a bucketName');
        assert(
            isUndefined(options) || isPlainObject(options),
            'CloudflareAPIClient#getR2Bucket() options must be an object',
        );

        const jurisdiction = options?.jurisdiction;
        const headers = {};

        // R2 selects a jurisdiction by request header rather than by path.
        if (!isUndefined(jurisdiction)) {
            assertNonEmptyString(jurisdiction, 'CloudflareAPIClient#getR2Bucket() jurisdiction must be a non-empty string');
            headers['cf-r2-jurisdiction'] = jurisdiction;
        }

        return await this.#fetchResult(this.#accountUrl(`r2/buckets/${ bucketName }`), { method: 'GET', headers });
    }

    #accountUrl(pathname) {
        return new URL(`${ BASE_URL }/accounts/${ this.#accountId }/${ pathname }`);
    }

    async #fetchResult(url, init) {
        const { method } = init;
        const headers = {
            authorization: `Bearer ${ this.#apiToken }`,
            ...init.headers,
        };

        const res = await this.#fetch(url, { ...init, headers });

        if (!res.ok) {
            const text = this.#redact(await res.text());
            const details = text ? `: ${ text }` : '';

            // Spend one extra request, on the failure path only, to learn
            // whether the operator must replace the token or widen it.
            let tokenStatus = null;
            if (AUTH_STATUSES.includes(res.status)) {
                const verification = await this.verifyToken();
                tokenStatus = verification.status;
            }

            throw new CloudflareApiError(
                `Unexpected HTTP status ${ res.status } from ${ method } ${ url.href }${ details }`,
                {
                    status: res.status,
                    errors: parseErrorEnvelope(text),
                    method,
                    url: url.href,
                    tokenStatus,
                },
            );
        }

        const { success, errors, messages, result } = await res.json();

        if (success) {
            return result;
        }

        let message = 'No error message provided';
        if (Array.isArray(errors) && errors.length > 0 && errors[0].message) {
            message = errors[0].message;
        } else if (Array.isArray(messages) && messages.length > 0 && messages[0].message) {
            message = messages[0].message;
        }

        throw new CloudflareApiError(
            `API error "${ this.#redact(message) }" from ${ method } ${ url.href }`,
            {
                status: res.status,
                errors: this.#redact(Array.isArray(errors) ? errors : []),
                method,
                url: url.href,
            },
        );
    }

    // Cloudflare does not echo the token today, but an error message is
    // printed and may be pasted into a bug report, so never trust that.
    #redact(value) {
        if (isString(value)) {
            return value.split(this.#apiToken).join('[redacted]');
        }

        if (Array.isArray(value)) {
            return value.map((entry) => this.#redact(entry));
        }

        if (isPlainObject(value)) {
            const redacted = {};
            for (const [ key, entry ] of Object.entries(value)) {
                redacted[key] = this.#redact(entry);
            }
            return redacted;
        }

        return value;
    }
}

// Reads a body expected to be a Cloudflare envelope that may be anything,
// including an HTML error page from a proxy. Returns null rather than throwing.
async function readJsonBody(res) {
    let text;

    try {
        text = await res.text();
    } catch {
        return null;
    }

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// Cloudflare sends its envelope with non-2xx responses too. Lifting the errors
// array out lets a caller branch on a Cloudflare error code.
function parseErrorEnvelope(text) {
    if (!text) {
        return [];
    }

    let body;

    try {
        body = JSON.parse(text);
    } catch {
        return [];
    }

    return Array.isArray(body?.errors) ? body.errors : [];
}
