import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    DEFAULT_PUBLISHING_API_TOKEN_ROLE,
    DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS,
    MAX_PUBLISHING_API_TOKEN_TTL_SECONDS,
} from '../../../../../../src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';
import { createPublishingApiToken } from '../../../../../../src/app/presentation/request-handlers/admin-api/create-publishing-api-token.js';


const ADMIN_USER_ID = 'admin-1';
const TOKEN_ID = 'token-1';
const PLAINTEXT_TOKEN = 'plaintext-token-value';
const CREATION_DATE = '2026-07-21T09:30:00.000Z';
const EXPIRATION_DATE = '2026-08-20T09:30:00.000Z';


describe('createPublishingApiToken admin API handler', ({ it }) => {
    it('mints a token from the submitted attributes and returns it as a committed JSON API resource', async () => {
        const harness = makeHarness();
        const response = makeResponse();

        await createPublishingApiToken(
            harness.context,
            makeRequest({
                attributes: {
                    roles: [ 'Editor' ],
                    timeToLiveSeconds: 3600,
                    description: 'CI publisher',
                },
            }),
            response,
        );

        assertEqual(201, response.status);
        assertEqual(JSON_API_CONTENT_TYPE, response.options.contentType);
        assertEqual('PublishingApiToken', response.document.data.type);
        assertEqual(TOKEN_ID, response.document.data.id);
        assertEqual(1, harness.calls.creates.length);
        assertEqual(3600, harness.calls.creates[0].attributes.ttlSeconds);
        assertEqual('CI publisher', harness.calls.creates[0].attributes.description);
        assertEqual('Editor', harness.calls.creates[0].attributes.roles[0]);
    });

    it('returns the plaintext token alongside the stored attributes', async () => {
        const harness = makeHarness();
        const response = makeResponse();

        await createPublishingApiToken(harness.context, makeRequest(), response);

        // The plaintext value exists only on this response; the stored record
        // keeps a hash, so a client which discards it must mint a new token.
        const { attributes } = response.document.data;
        assertEqual(PLAINTEXT_TOKEN, attributes.token);
        assertEqual(ADMIN_USER_ID, attributes.createdBy);
        assertEqual('CI publisher', attributes.description);
        assertEqual(CREATION_DATE, attributes.tokenCreationDate);
        assertEqual(EXPIRATION_DATE, attributes.tokenExpirationDate);
        assertEqual(DEFAULT_PUBLISHING_API_TOKEN_ROLE, attributes.roles[0]);
    });

    it('attributes the token to the authenticated admin rather than the request body', async () => {
        const harness = makeHarness();

        await createPublishingApiToken(
            harness.context,
            makeRequest({ attributes: { createdBy: 'someone-else' } }),
            makeResponse(),
        );

        assertEqual(ADMIN_USER_ID, harness.calls.creates[0].attributes.createdBy);
    });

    it('applies role and lifetime defaults when the attributes are empty', async () => {
        const harness = makeHarness();

        await createPublishingApiToken(harness.context, makeRequest({ attributes: {} }), makeResponse());

        const { attributes } = harness.calls.creates[0];
        assertEqual(1, attributes.roles.length);
        assertEqual(DEFAULT_PUBLISHING_API_TOKEN_ROLE, attributes.roles[0]);
        assertEqual(DEFAULT_PUBLISHING_API_TOKEN_TTL_SECONDS, attributes.ttlSeconds);
        assertEqual(null, attributes.description);
    });

    it('rejects a request body which is not JSON API before reading the body', async () => {
        const harness = makeHarness();
        const request = makeRequest({ contentType: 'application/json' });
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(harness.context, request, makeResponse());
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('UnsupportedMediaTypeError', caught.name);
        assertEqual(415, caught.httpStatusCode);
        assertEqual(0, request.calls.json);
        assertEqual(0, harness.calls.collectionNames.length);
    });

    it('rejects a JSON API resource type which is not PublishingApiToken', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(
                harness.context,
                makeRequest({ type: 'AdminUser' }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual(409, caught.httpStatusCode);
        assertEqual('JsonApiResourceTypeMismatch', caught.code);
        assertEqual(0, harness.calls.creates.length);
    });

    it('rejects a role which is not a registered publishing role', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(
                harness.context,
                makeRequest({ attributes: { roles: [ 'Root Admin' ] } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(422, caught.httpStatusCode);
        assertEqual(0, harness.calls.creates.length);
    });

    it('rejects a lifetime beyond the maximum', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(
                harness.context,
                makeRequest({
                    attributes: { timeToLiveSeconds: MAX_PUBLISHING_API_TOKEN_TTL_SECONDS + 1 },
                }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(422, caught.httpStatusCode);
        assertEqual(0, harness.calls.creates.length);
    });

    it('rejects a non-integer lifetime', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(
                harness.context,
                makeRequest({ attributes: { timeToLiveSeconds: '3600' } }),
                makeResponse(),
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('ValidationError', caught.name);
        assertEqual(0, harness.calls.creates.length);
    });

    it('wraps an unexpected storage failure without committing a response', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ createTokenError: cause });
        const response = makeResponse();
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(harness.context, makeRequest(), response);
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while creating a publishing API token', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(undefined, response.status);
    });
});

function makeHarness(options) {
    const { createTokenError = null } = options ?? {};
    const calls = {
        collectionNames: [],
        creates: [],
    };
    const publishingApiTokens = {
        async createToken(context, attributes) {
            calls.creates.push({ context, attributes });
            if (createTokenError) {
                throw createTokenError;
            }
            return {
                token: PLAINTEXT_TOKEN,
                record: makeTokenRecord(attributes),
            };
        },
    };
    const context = {
        requestId: 'request-1',
        user: { id: ADMIN_USER_ID },
        getCollection(name) {
            calls.collectionNames.push(name);
            if (name === 'PublishingApiToken') {
                return publishingApiTokens;
            }
            throw new Error(`Unexpected collection: ${ name }`);
        },
    };

    return { context, calls };
}

function makeRequest(options) {
    const {
        contentType = JSON_API_CONTENT_TYPE,
        type = 'PublishingApiToken',
        attributes = { description: 'CI publisher' },
    } = options ?? {};

    return {
        calls: { json: 0 },
        getContentMediaType() {
            return contentType;
        },
        async json() {
            this.calls.json += 1;
            return { data: { type, attributes } };
        },
    };
}

function makeResponse() {
    return {
        respondWithJSON(status, document, options) {
            this.status = status;
            this.document = document;
            this.options = options;
            return this;
        },
    };
}

function makeTokenRecord(attributes) {
    const values = {
        roles: attributes.roles,
        description: attributes.description,
        createdBy: attributes.createdBy,
        tokenCreationDate: CREATION_DATE,
        tokenExpirationDate: EXPIRATION_DATE,
    };

    return {
        id: TOKEN_ID,
        get(name) {
            return values[name];
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
