/**
 * Authenticated client for the Kixx Admin API.
 * @module admin-api-client
 */

import {
    assert,
    assertNonEmptyString,
    isFunction,
    isUndefined,
} from '../vendor/kixx-assert/mod.js';

import AdminApiError, { createAdminApiError } from './admin-api-error.js';

const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 100;

/**
 * Sends Admin API requests to one application environment.
 *
 * Read requests (`GET`) retry on 429 and 5xx responses and on network
 * failures. Write requests (`POST`) retry on 429 only; a 5xx response or a
 * network failure on a write surfaces immediately, because
 * `POST /migrations/:id/run` mutates durable ledger state and the client
 * should not rely on migration idempotency to paper over its own retries.
 */
export default class AdminAPIClient {

    #baseUrl;
    #email;
    #password;
    #fetch;
    #wait;
    #random;

    /**
     * @param {Object} options - Client configuration
     * @param {string} options.origin - Admin deployment's origin
     * @param {string} [options.email] - Admin account email for HTTP Basic auth
     * @param {string} [options.password] - Admin account password for HTTP Basic auth
     * @param {typeof fetch} [options.fetch] - Fetch implementation
     * @param {(milliseconds: number) => Promise<void>} [options.wait] - Retry wait implementation
     * @param {() => number} [options.random] - Retry jitter source
     */
    constructor(options) {
        const {
            origin,
            email,
            password,
            fetch: fetchImpl = globalThis.fetch,
            wait = delay,
            random = Math.random,
        } = options ?? {};

        assertNonEmptyString(origin);
        assert(isFunction(fetchImpl), 'AdminAPIClient() requires a fetch function');
        assert(isFunction(wait), 'AdminAPIClient() requires a wait function');
        assert(isFunction(random), 'AdminAPIClient() requires a random function');

        this.#baseUrl = new URL('/admin-api/v1/', origin);
        this.#email = email;
        this.#password = password;
        this.#fetch = fetchImpl;
        this.#wait = wait;
        this.#random = random;
    }

    /**
     * Lists every registered migration with its durable status, in registry order.
     * @returns {Promise<Object[]>} Migration records
     */
    async listMigrations() {
        const response = await this.#request('migrations', { isWrite: false });
        return response.data.map(migrationRecord);
    }

    /**
     * Runs one bounded batch of a migration.
     * @param {string} id - Permanent migration id
     * @param {Object} [options] - Batch options
     * @param {boolean} [options.dryRun] - Preview the batch without mutating anything
     * @param {boolean} [options.force] - Restart an applied or failed real run from the beginning
     * @param {?string} [options.cursor] - Opaque dry-run cursor from a prior batch
     * @returns {Promise<Object>} `done`, `cursor`, `stats`, `status`, and `dryRun`
     * @throws {AssertionError} When `dryRun` and `force` are both `true`
     * @throws {MigrationAlreadyAppliedError} When rerunning an applied migration without `force`
     * @throws {MigrationCursorConflictError} When the stored ledger cursor is invalid; restart with `force`
     * @throws {MigrationConcurrencyError} When another operator advanced the migration first
     */
    async runMigration(id, options) {
        const { dryRun, force, cursor } = options ?? {};

        assertNonEmptyString(id);
        assert(!(dryRun && force), 'runMigration() cannot pass both dryRun and force');

        const attributes = {};

        if (!isUndefined(dryRun)) {
            attributes.dryRun = dryRun;
        }
        if (!isUndefined(force)) {
            attributes.force = force;
        }
        if (!isUndefined(cursor)) {
            attributes.cursor = cursor;
        }

        const endpoint = `migrations/${ encodeURIComponent(id) }/run`;
        const response = await this.#postJsonApi(endpoint, 'MigrationRun', attributes);

        return { ...response.data.attributes };
    }

    /**
     * Redeems a one-time invite token to create the admin account it grants.
     * @param {string} inviteToken - Bearer invite token
     * @param {Object} account - New account attributes
     * @param {string} account.emailAddress - New account email address
     * @param {string} account.password - New account password, 12 to 256 characters
     * @returns {Promise<Object>} Created account id, email address, and creation date
     * @throws {InvalidInviteError} When the token is unknown, expired, revoked, or already used
     * @throws {NewUserConflictError} When an admin already exists for the email; the invite is not consumed
     * @throws {InviteSpentInEmailRaceError} When a concurrent signup claimed the email; the invite is consumed
     */
    async acceptInvite(inviteToken, account) {
        const { emailAddress, password } = account ?? {};

        assertNonEmptyString(inviteToken);
        assertNonEmptyString(emailAddress);
        assertNonEmptyString(password);

        const response = await this.#request('users/invite', {
            method: 'POST',
            isWrite: true,
            authorization: `Bearer ${ inviteToken }`,
            body: JSON.stringify({
                data: {
                    type: 'AdminUser',
                    attributes: { emailAddress, password },
                },
            }),
            headers: { 'content-type': JSON_API_CONTENT_TYPE },
            redact: [ inviteToken, password ],
        });

        return {
            adminUserId: response.data.id,
            ...response.data.attributes,
        };
    }

    /**
     * Mints a bearer token for the separate Publishing API.
     * @param {Object} [options] - Token attributes
     * @param {string[]} [options.roles] - Publishing role ids, defaults to `["editor"]`
     * @param {number} [options.ttl] - Time to live in seconds, defaults to 2592000
     * @param {string} [options.description] - Operator-facing description
     * @returns {Promise<Object>} The one-time plaintext token with its metadata
     */
    async createPublishingApiToken(options) {
        const { roles, ttl, description } = options ?? {};
        const attributes = {};

        if (!isUndefined(roles)) {
            attributes.roles = roles;
        }
        if (!isUndefined(ttl)) {
            attributes.timeToLiveSeconds = ttl;
        }
        if (!isUndefined(description)) {
            attributes.description = description;
        }

        const response = await this.#postJsonApi(
            'publishing-api-tokens',
            'PublishingApiToken',
            attributes,
        );

        return {
            tokenId: response.data.id,
            ...response.data.attributes,
        };
    }

    async #postJsonApi(endpoint, type, attributes) {
        return await this.#request(endpoint, {
            method: 'POST',
            isWrite: true,
            body: JSON.stringify({
                data: { type, attributes },
            }),
            headers: { 'content-type': JSON_API_CONTENT_TYPE },
        });
    }

    async #request(endpoint, options) {
        const {
            method = 'GET',
            isWrite,
            authorization,
            headers,
            body,
            redact = [],
        } = options;

        const url = new URL(endpoint, this.#baseUrl);
        const secrets = [ ...redact ];
        let requestAuthorization = authorization;

        if (!requestAuthorization) {
            const credentials = this.#basicCredentials();
            requestAuthorization = `Basic ${ credentials }`;
            secrets.push(this.#password, credentials);
        }

        const requestHeaders = { authorization: requestAuthorization, ...headers };

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            let response;

            try {
                response = await this.#fetch(url, { method, headers: requestHeaders, body });
            } catch (cause) {
                if (!isWrite && attempt < MAX_ATTEMPTS) {
                    await this.#waitBeforeRetry(attempt);
                    continue;
                }

                throw new AdminApiError(
                    `Admin API network request failed after ${ attempt } attempts: ${ method } ${ url.href }`,
                    { status: null, method, url: url.href, attempts: attempt, cause },
                );
            }

            if (this.#isRetryable(response.status, isWrite) && attempt < MAX_ATTEMPTS) {
                await this.#waitBeforeRetry(attempt);
                continue;
            }

            return await this.#readResponse(response, { method, url, attempt, secrets });
        }
    }

    #isRetryable(status, isWrite) {
        if (status === 429) {
            return true;
        }
        return !isWrite && status >= 500;
    }

    #basicCredentials() {
        assertNonEmptyString(this.#email);
        assertNonEmptyString(this.#password);
        return encodeBase64(`${ this.#email }:${ this.#password }`);
    }

    async #waitBeforeRetry(attempt) {
        const exponentialDelay = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
        const jitteredDelay = exponentialDelay * (0.5 + this.#random());
        await this.#wait(jitteredDelay);
    }

    async #readResponse(response, request) {
        const { method, url, attempt, secrets } = request;
        const text = await response.text();
        const document = parseJson(text);

        if (!response.ok) {
            const errors = redactErrors(
                Array.isArray(document?.errors) ? document.errors : [],
                secrets,
            );
            const message = redactAll(
                `Admin API returned HTTP ${ response.status } from ${ method } ${ url.href }`
                + formatErrorsSuffix(errors, text),
                secrets,
            );

            throw createAdminApiError(message, {
                status: response.status,
                errors,
                method,
                url: url.href,
                attempts: attempt,
            });
        }

        if (!document?.data) {
            throw new AdminApiError(
                `Admin API returned an invalid JSON:API document from ${ method } ${ url.href }`,
                { status: response.status, method, url: url.href, attempts: attempt },
            );
        }

        return { data: document.data, status: response.status };
    }
}

function migrationRecord(resource) {
    return { id: resource.id, ...resource.attributes };
}

// HTTP Basic credentials are base64 of the UTF-8 bytes. btoa() alone only
// accepts Latin-1, so encode first.
function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

function formatErrorsSuffix(errors, text) {
    if (errors.length > 0) {
        return `\n${ errors.map(formatJsonApiError).join('\n') }`;
    }
    if (text) {
        return `\n${ text }`;
    }
    return '';
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

function redactAll(message, secrets) {
    return secrets
        .filter(Boolean)
        .reduce((result, secret) => result.split(secret).join('[redacted]'), message);
}

function redactErrors(errors, secrets) {
    return errors.map((error) => JSON.parse(redactAll(JSON.stringify(error), secrets)));
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
