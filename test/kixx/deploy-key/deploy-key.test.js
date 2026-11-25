import util from 'node:util';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertFalsy } from 'kixx-assert';

import {
    DEPLOY_KEY_PREFIX,
    DEPLOY_KEY_HASH_SECRET,
    generateDeployKey,
    isDeployKeyHash,
    verifyDeployKey,
    requireDeployKey,
    deployKeyActor,
} from '../../../kixx/deploy-key/mod.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';
import { mapErrorToJsonApiError } from '../../../kixx/http-router/json-api-errors.js';


// A made-up key and its SHA-256, for these tests only.
const TEST_KEY = 'kxdk_5b0e6c1f2a9d4e7b8c3f6a1d0e9b2c5f8a7d4e1b6c9f0a3d2e5b8c1f4a7d0e3b';
const OTHER_KEY = 'kxdk_0000000000000000000000000000000000000000000000000000000000000001';

let TEST_HASH;


// Records every log call, so a test can assert no secret reached a log line.
function makeLogger() {
    const lines = [];
    const record = (level) => (...args) => lines.push({ level, args });

    return {
        lines,
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        createChild() {
            return this;
        },
    };
}

function makeContext({ hash, environment = 'production' } = {}) {
    const env = {};

    if (hash !== undefined) {
        env[DEPLOY_KEY_HASH_SECRET] = hash;
    }

    return { env, config: { environment }, logger: makeLogger() };
}

// getAuthorizationBearer() returns null for a missing or malformed header,
// as the server request does.
function makeRequest(bearer = null) {
    return {
        ip: '203.0.113.7',
        getAuthorizationBearer() {
            return bearer;
        },
    };
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}

function assertNoSecret(value, label) {
    const text = typeof value === 'string' ? value : util.inspect(value, { depth: 8 });

    assertFalsy(text.includes(TEST_KEY), `${ label } holds the key`);
    assertFalsy(text.includes(TEST_HASH), `${ label } holds the hash`);
    assertFalsy(text.includes(TEST_HASH.slice(0, 12)), `${ label } holds a hash prefix`);
}


describe('deploy-key', ({ before, describe }) => {
    before(async () => {
        TEST_HASH = await sha256Hex(TEST_KEY);
    });

    describe('generateDeployKey', ({ it }) => {
        it('yields kxdk_ and 64 lowercase hex characters, and its SHA-256', async () => {
            const { key, hash } = await generateDeployKey();

            assertEqual('kxdk_', DEPLOY_KEY_PREFIX);
            assertMatches(/^kxdk_[0-9a-f]{64}$/, key);
            assertEqual(await sha256Hex(key), hash);
            assert(isDeployKeyHash(hash));
        });

        it('yields a different key each time', async () => {
            const first = await generateDeployKey();
            const second = await generateDeployKey();

            assert(first.key !== second.key);
            assert(first.hash !== second.hash);
        });
    });

    describe('isDeployKeyHash', ({ it }) => {
        it('accepts 64 lowercase hex characters only', () => {
            assert(isDeployKeyHash(TEST_HASH));

            for (const value of [ undefined, null, '', 'not-a-hash', TEST_HASH.toUpperCase(), `${ TEST_HASH }0`, TEST_HASH.slice(1), 7 ]) {
                assertFalsy(isDeployKeyHash(value), `accepted ${ JSON.stringify(value) }`);
            }
        });
    });

    describe('verifyDeployKey', ({ it }) => {
        it('passes the correct key', async () => {
            assertEqual(true, await verifyDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(TEST_KEY)));
        });

        it('fails a wrong key', async () => {
            assertEqual(false, await verifyDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(OTHER_KEY)));
        });

        it('fails a credential that isn\'t a deploy key', async () => {
            assertEqual(false, await verifyDeployKey(makeContext({ hash: TEST_HASH }), makeRequest('not-a-key')));
        });

        it('fails the hash presented as the credential', async () => {
            assertEqual(false, await verifyDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(TEST_HASH)));
        });

        it('fails a missing or malformed Authorization header', async () => {
            assertEqual(false, await verifyDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(null)));
        });

        it('passes everything in development with no hash', async () => {
            for (const hash of [ undefined, '' ]) {
                const context = makeContext({ hash, environment: 'development' });

                assertEqual(true, await verifyDeployKey(context, makeRequest(null)));
                assertEqual(true, await verifyDeployKey(context, makeRequest(OTHER_KEY)));
                assertEqual(true, await verifyDeployKey(context, makeRequest('anything')));
            }
        });

        it('enforces a hash set in development', async () => {
            const context = makeContext({ hash: TEST_HASH, environment: 'development' });

            assertEqual(true, await verifyDeployKey(context, makeRequest(TEST_KEY)));
            assertEqual(false, await verifyDeployKey(context, makeRequest(OTHER_KEY)));
            assertEqual(false, await verifyDeployKey(context, makeRequest(null)));
        });
    });

    describe('requireDeployKey', ({ it }) => {
        it('returns the response for the correct key', async () => {
            const response = {};

            assertEqual(response, await requireDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(TEST_KEY), response));
        });

        it('returns the response in development with no hash', async () => {
            const response = {};
            const context = makeContext({ environment: 'development' });

            assertEqual(response, await requireDeployKey(context, makeRequest(null), response));
        });

        it('leaves context.user alone', async () => {
            const context = makeContext({ hash: TEST_HASH });

            await requireDeployKey(context, makeRequest(TEST_KEY), {});

            assertFalsy('user' in context);
        });

        it('throws 401 DeployKeyRequired for a wrong or missing key', async () => {
            for (const bearer of [ OTHER_KEY, null ]) {
                const caught = await catchRejection(requireDeployKey(makeContext({ hash: TEST_HASH }), makeRequest(bearer), {}));

                assert(caught, 'expected a rejection');
                assertEqual('UnauthenticatedError', caught.name);
                assertEqual(401, caught.httpStatusCode);
                assertEqual('DeployKeyRequired', caught.code);
                assertEqual('A valid deploy key is required.', caught.message);
                assertEqual(true, caught.expected);
            }
        });

        it('puts neither key nor hash in the error, its JSON:API form, or a log line', async () => {
            const context = makeContext({ hash: TEST_HASH });

            for (const bearer of [ TEST_KEY.slice(0, -1) + '0', TEST_KEY.toUpperCase() ]) {
                const caught = await catchRejection(requireDeployKey(context, makeRequest(bearer), {}));

                assertNoSecret(caught, 'the error');
                assertNoSecret(caught.stack ?? '', 'the stack');
                assertNoSecret(JSON.stringify(mapErrorToJsonApiError(caught)), 'the JSON:API error');
                assertFalsy(util.inspect(caught).includes(bearer), 'the error holds the credential');
            }

            await requireDeployKey(context, makeRequest(TEST_KEY), {});

            assertNoSecret(context.logger.lines, 'the log');
        });
    });

    describe('deployKeyActor', ({ it }) => {
        it('names the key by the first 12 characters of its hash', () => {
            const actor = deployKeyActor(makeContext({ hash: TEST_HASH }));

            assertEqual('deploy-key', actor.type);
            assertEqual(TEST_HASH.slice(0, 12), actor.id);
            assertEqual('Deploy key', actor.name);
            assertEqual('id,name,type', Object.keys(actor).sort().join(','));
        });

        it('is "development" when the key is open', () => {
            const actor = deployKeyActor(makeContext({ environment: 'development' }));

            assertEqual('deploy-key', actor.type);
            assertEqual('development', actor.id);
            assertEqual('Deploy key', actor.name);
        });
    });
});
