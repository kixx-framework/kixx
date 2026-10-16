/**
 * Authenticated client for the Kixx Publishing API.
 * @module publishing-api-client
 */

import {
    assert,
    assertArray,
    assertNonEmptyString,
    isFunction,
    isNonEmptyString,
    isString,
    isUndefined,
} from '../vendor/kixx-assert/mod.js';

import { parseRetryAfter } from '../parse-retry-after.js';
import { getBlobSize } from './addressing.js';
import PublishingApiError, { createPublishingApiError } from './publishing-api-error.js';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 100;
// A 503 means the server is overloaded; a fast retry only adds to the load.
const OVERLOADED_RETRY_BASE_DELAY_MS = 1000;
// Bounds a server's Retry-After so one bad hint cannot stall a publish.
const MAX_RETRY_AFTER_MS = 30000;
// Spreads out concurrent uploads that all received the same Retry-After.
const RETRY_AFTER_JITTER_MS = 1000;
const RETRY_STATUSES = new Set([ 429 ]);

/**
 * Sends Publishing API requests to one application environment.
 */
export default class PublishingAPIClient {

    #baseUrl;
    #token;
    #fetch;
    #wait;
    #random;
    #now;
    #discovery;
    #serverOverloaded = false;

    /**
     * @param {Object} options - Client configuration
     * @param {string} options.origin - Published application's origin
     * @param {string} options.token - Publishing bearer token
     * @param {typeof fetch} [options.fetch] - Fetch implementation
     * @param {(milliseconds: number) => Promise<void>} [options.wait] - Retry wait implementation
     * @param {() => number} [options.random] - Retry jitter source
     * @param {() => number} [options.now] - Current time in epoch milliseconds, for HTTP-date `Retry-After` values
     */
    constructor(options) {
        const {
            origin,
            token,
            fetch: fetchImpl = fetch,
            wait = delay,
            random = Math.random,
            now = Date.now,
        } = options ?? {};

        assertNonEmptyString(origin);
        assertNonEmptyString(token);
        assert(isFunction(fetchImpl), 'PublishingAPIClient() requires a fetch function');
        assert(isFunction(wait), 'PublishingAPIClient() requires a wait function');
        assert(isFunction(random), 'PublishingAPIClient() requires a random function');
        assert(isFunction(now), 'PublishingAPIClient() requires a now function');

        this.#baseUrl = new URL('/publishing-api/v1/', origin);
        this.#token = token;
        this.#fetch = fetchImpl;
        this.#wait = wait;
        this.#random = random;
        this.#now = now;
    }

    /**
     * True once any response through this client had status 503, whether or
     * not the request was then retried or failed. Sticky for the life of the
     * client, so callers can reduce load for the rest of a run.
     * @type {boolean}
     */
    get serverOverloaded() {
        return this.#serverOverloaded;
    }

    /**
     * Retrieves the server's publishing capabilities without making a write.
     *
     * Memoized for the life of the client. Discovery reports immutable
     * properties of one running deploy, and every write path negotiates them,
     * so repeated calls must not cost repeated round trips.
     * @returns {Promise<Object>} Discovery attributes and enforced limits
     */
    async discover() {
        if (!this.#discovery) {
            // Cache the promise, not the result, so concurrent callers share
            // one in-flight request instead of racing two.
            this.#discovery = this.#requestDiscovery();

            // A failure must not poison the client for the rest of the
            // process. Clearing here also marks the rejection handled.
            this.#discovery.catch(() => {
                this.#discovery = null;
            });
        }

        return await this.#discovery;
    }

    /**
     * Reports stored objects in a deduplicated set of requested ids.
     * @param {string[]} objectIds - Object ids to check
     * @param {Object} options - Server-discovered limits
     * @param {number} options.maxObjectStatusIds - Maximum ids per request
     * @returns {Promise<Array<{objectId: string, size: number}>>} Stored objects in server order
     */
    async getObjectStatus(objectIds, options) {
        const { maxObjectStatusIds } = options ?? {};

        assertArray(objectIds);
        assert(
            Number.isInteger(maxObjectStatusIds) && maxObjectStatusIds > 0,
            'getObjectStatus() requires a positive maxObjectStatusIds limit',
        );

        const uniqueIds = [ ...new Set(objectIds) ];
        const storedObjects = [];

        for (let index = 0; index < uniqueIds.length; index += maxObjectStatusIds) {
            const batch = uniqueIds.slice(index, index + maxObjectStatusIds);
            const response = await this.#postJsonApi('objects/status', 'ObjectStatus', {
                objectIds: batch,
            });

            assertArray(response.data, 'Publishing API ObjectStatus response data');
            storedObjects.push(...response.data.map((resource) => ({
                objectId: resource.id,
                size: resource.attributes.size,
            })));
        }

        return storedObjects;
    }

    /**
     * Uploads one content-addressed object as raw bytes.
     * @param {string} objectId - Expected content address
     * @param {string|ArrayBuffer} body - Object bytes
     * @param {Object} options - Server-discovered limits
     * @param {number} options.maxObjectBytes - Maximum object size
     * @returns {Promise<{objectId: string, size: number, created: boolean}>} Stored object result
     */
    async uploadObject(objectId, body, options) {
        const { maxObjectBytes } = options ?? {};

        assertNonEmptyString(objectId);
        assert(
            Number.isInteger(maxObjectBytes) && maxObjectBytes > 0,
            'uploadObject() requires a positive maxObjectBytes limit',
        );

        const size = getBlobSize(body);
        assert(size > 0, 'uploadObject() body must not be empty');
        assert(
            size <= maxObjectBytes,
            `uploadObject() body is ${ size } bytes; server limit is ${ maxObjectBytes } bytes`,
        );

        // A byte buffer, never a stream, so fetch sends Content-Length. The
        // server answers 411 without it.
        const response = await this.#request(`objects/${ encodeURIComponent(objectId) }`, {
            method: 'PUT',
            body: toBytes(body),
        });

        return {
            objectId: response.data.id,
            size: response.data.attributes.size,
            created: response.status === 201,
        };
    }

    /**
     * Creates and fully verifies an immutable Release.
     * @param {Object} manifest - Complete Release manifest
     * @param {Object} [provenance] - Non-binding source metadata
     * @returns {Promise<Object>} Created or existing Release record
     */
    async createRelease(manifest, provenance) {
        const attributes = { manifest };
        if (!isUndefined(provenance)) {
            attributes.provenance = provenance;
        }
        const response = await this.#postJsonApi('releases', 'Release', attributes);
        return releaseRecord(response.data);
    }

    /**
     * Gets one authoritative build pointer.
     * @param {string} buildId - Build pointer id
     * @returns {Promise<Object>} Build pointer record
     */
    async getBuild(buildId) {
        assertNonEmptyString(buildId);
        const response = await this.#request(`builds/${ encodeURIComponent(buildId) }`);
        return buildRecord(response.data);
    }

    /**
     * Assigns a Release to a build under the protocol's mandatory precondition.
     *
     * The precondition travels in the request body as `expectedAssignmentId`:
     * the opaque identity observed in Build JSON, or null for a build that has
     * never been assigned. Copy it verbatim from a Build record. A server
     * serving assignment protocol 2 rejects `If-Match` and `If-None-Match`,
     * and never derives the identity from a release id or a response header.
     *
     * The request is attempted exactly once. Protocol 2 has no idempotent
     * retry: resending after a lost response fails its precondition even
     * though the first attempt committed. Reconcile with `getBuild()` instead
     * of retrying.
     * @param {string} buildId - Build pointer id
     * @param {string} releaseId - Release to assign
     * @param {Object} options - Assignment options
     * @param {?string} options.expectedAssignmentId - Observed assignment identity, or null for a never-assigned build
     * @param {string} [options.reason=publish] - Assignment audit reason
     * @returns {Promise<Object>} Resulting build pointer record, carrying the identity the next write must quote
     * @throws {PreconditionRequiredError} When the server receives no precondition
     * @throws {BuildPointerConflictError} When the observed identity is stale
     */
    async assignBuild(buildId, releaseId, options) {
        const { expectedAssignmentId, reason = 'publish' } = options ?? {};

        assertNonEmptyString(buildId);
        assertNonEmptyString(releaseId);

        // Catch an omitted precondition here rather than letting the server
        // answer 428. The shape is all this client checks: the identity is
        // opaque, and the server owns its vocabulary.
        assert(
            expectedAssignmentId === null || isNonEmptyString(expectedAssignmentId),
            'assignBuild() requires expectedAssignmentId: an observed assignment id, or null ' +
            'for a build that has never been assigned',
        );

        const response = await this.#request(`builds/${ encodeURIComponent(buildId) }`, {
            method: 'PUT',
            retry: false,
            headers: {
                'content-type': JSON_API_CONTENT_TYPE,
            },
            body: JSON.stringify({
                data: {
                    type: 'Build',
                    id: buildId,
                    attributes: { releaseId, expectedAssignmentId, reason },
                },
            }),
        });

        return buildRecord(response.data);
    }

    async #requestDiscovery() {
        const response = await this.#request('');
        return response.data.attributes;
    }

    async #postJsonApi(endpoint, type, attributes) {
        return await this.#request(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                data: {
                    type,
                    attributes,
                },
            }),
            headers: {
                'content-type': JSON_API_CONTENT_TYPE,
            },
        });
    }

    async #request(endpoint, options) {
        const {
            method = 'GET',
            headers: requestHeaders,
            body,
            // Retrying is safe only where the endpoint is idempotent. A write
            // that is not must opt out here, at the call site that knows it.
            retry = true,
        } = options ?? {};
        const url = new URL(endpoint, this.#baseUrl);
        const headers = {
            authorization: `Bearer ${ this.#token }`,
            ...requestHeaders,
        };
        const maxAttempts = retry ? MAX_ATTEMPTS : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            let response;

            try {
                response = await this.#fetch(url, { method, headers, body });
            } catch {
                if (attempt < maxAttempts) {
                    await this.#waitBeforeRetry(attempt);
                    continue;
                }

                throw new PublishingApiError(
                    `Publishing API network request failed after ${ attempt } attempts: ${ method } ${ url.href }`,
                    { status: null, method, url: url.href, attempts: attempt },
                );
            }

            if (response.status === 503) {
                this.#serverOverloaded = true;
            }

            if (isRetryableStatus(response.status) && attempt < maxAttempts) {
                await this.#waitBeforeRetryingResponse(response, attempt);
                continue;
            }

            return await this.#readResponse(response, { method, url, attempt });
        }
    }

    async #waitBeforeRetry(attempt, baseDelay = RETRY_BASE_DELAY_MS) {
        const exponentialDelay = baseDelay * (2 ** (attempt - 1));
        const jitteredDelay = exponentialDelay * (0.5 + this.#random());
        await this.#wait(jitteredDelay);
    }

    async #waitBeforeRetryingResponse(response, attempt) {
        // Test fakes and unusual fetch implementations may omit headers.
        const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'), this.#now());

        if (retryAfterMs !== null) {
            // Never wait less than the (capped) delay the server asked for.
            const delayMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) + (this.#random() * RETRY_AFTER_JITTER_MS);
            await this.#wait(delayMs);
            return;
        }

        if (response.status === 503) {
            await this.#waitBeforeRetry(attempt, OVERLOADED_RETRY_BASE_DELAY_MS);
            return;
        }

        await this.#waitBeforeRetry(attempt);
    }

    async #readResponse(response, request) {
        const { method, url, attempt } = request;
        const text = await response.text();
        const document = parseJson(text);

        if (!response.ok) {
            const errors = redactErrors(
                Array.isArray(document?.errors) ? document.errors : [],
                this.#token,
            );
            const message = this.#formatFailure(response.status, method, url, errors, text);

            throw createPublishingApiError(message, {
                status: response.status,
                errors,
                method,
                url: url.href,
                attempts: attempt,
            });
        }

        if (!document?.data) {
            throw new PublishingApiError(
                `Publishing API returned an invalid JSON:API document from ${ method } ${ url.href }`,
                { status: response.status, method, url: url.href, attempts: attempt },
            );
        }

        return {
            data: document.data,
            meta: document.meta,
            status: response.status,
        };
    }

    #formatFailure(status, method, url, errors, text) {
        let message = `Publishing API returned HTTP ${ status } from ${ method } ${ url.href }`;

        if (status === 401 || status === 403) {
            message += '\nCheck .kixx/secrets.json at app.environments.<environment>.publishingToken.';
        }

        if (errors.length > 0) {
            message += `\n${ errors.map(formatJsonApiError).join('\n') }`;
        } else if (text) {
            message += `\n${ text }`;
        }

        return redact(message, this.#token);
    }
}

function toBytes(body) {
    if (isString(body)) {
        return new TextEncoder().encode(body);
    }
    return new Uint8Array(body);
}

function releaseRecord(resource) {
    return {
        releaseId: resource.id,
        ...resource.attributes,
    };
}

function buildRecord(resource) {
    return {
        buildId: resource.id,
        ...resource.attributes,
    };
}

function isRetryableStatus(status) {
    return RETRY_STATUSES.has(status) || status >= 500;
}

function formatJsonApiError(error, index) {
    const parts = [ `Error ${ index + 1 }:` ];

    if (error.status) {
        parts.push(`status ${ error.status }`);
    }
    if (error.code) {
        parts.push(`code ${ error.code }`);
    }
    if (error.detail) {
        parts.push(error.detail);
    }
    if (error.source) {
        parts.push(`source ${ JSON.stringify(error.source) }`);
    }

    return parts.join(' ');
}

function parseJson(text) {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function redact(message, secret) {
    return message.split(secret).join('[redacted]');
}

function redactErrors(errors, secret) {
    return errors.map((error) => {
        return JSON.parse(redact(JSON.stringify(error), secret));
    });
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
