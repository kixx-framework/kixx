/**
 * The deploy key guards the Publishing API, and failed attempts are counted
 * per client address in the target's real key/value store.
 */
import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';
import { getBaseUrl, getDeployKey, getTarget } from '../test-helpers/target.js';


const DISCOVERY_PATHNAME = '/publishing-api/v1/';

// Well formed, and nobody's key.
const WRONG_KEY = `kxdk_${ '0'.repeat(64) }`;

// DEPLOY_KEY_FAILURE_LIMIT in kixx/deploy-key/: this many failures from one
// address in a 15-minute window, then 429.
const FAILURE_LIMIT = 20;
const WINDOW_SECONDS = 900;

// The local target trusts X-Forwarded-For, so this file's failures are
// counted against addresses made up for this run, and never limit another
// test or a rerun. A target that doesn't trust the header counts them
// against the real address: about three failures a run.
const CLIENT_ADDRESS = randomAddress();
const RATE_LIMITED_ADDRESS = randomAddress();

// Cloudflare sets the client address itself, so there the rate-limit test
// would limit the operator's own address for wrong-key requests for up to 15
// minutes. It runs there only when asked for, and last.
const RUNS_RATE_LIMIT = getTarget() === 'local' || process.env.INTEGRATION_TESTS_RATE_LIMIT === '1';


describe('deploy key', ({ describe, it }) => {
    it('refuses a request with no key, without a WWW-Authenticate challenge', async () => {
        const response = await discover({ address: CLIENT_ADDRESS });
        const body = await response.json();

        assertEqual(401, response.status);
        assertEqual('DeployKeyRequired', body.errors[0].code);
        assertFalsy(response.headers.has('www-authenticate'));
    });

    it('refuses a request with a wrong key the same way', async () => {
        const response = await discover({ address: CLIENT_ADDRESS, key: WRONG_KEY });
        const body = await response.json();

        assertEqual(401, response.status);
        assertEqual('DeployKeyRequired', body.errors[0].code);
        assertFalsy(response.headers.has('www-authenticate'));
    });

    it('accepts the right key', async () => {
        const response = await discover({ address: CLIENT_ADDRESS, key: requireDeployKey() });

        await response.arrayBuffer();

        assertEqual(200, response.status);
    });

    if (RUNS_RATE_LIMIT) {
        describe('after too many failures from one address', ({ it }) => {
            // One test, so the count is this test's alone and in order.
            //
            // If this misses on Cloudflare, read it with two facts in mind.
            // The count lives in Workers KV, which is eventually consistent,
            // so it can lag and the limit can arrive late. And KV refuses a
            // second write to a key inside a second with a 429 of its own,
            // which the counter swallows by design: a burst can go
            // uncounted.
            it('answers 429 with Retry-After, and still accepts the right key', async () => {
                for (let attempt = 1; attempt <= FAILURE_LIMIT; attempt += 1) {
                    // eslint-disable-next-line no-await-in-loop
                    const response = await discover({ address: RATE_LIMITED_ADDRESS, key: WRONG_KEY });

                    // eslint-disable-next-line no-await-in-loop
                    await response.arrayBuffer();

                    assertEqual(401, response.status, `failure ${ attempt }`);
                }

                const limited = await discover({ address: RATE_LIMITED_ADDRESS, key: WRONG_KEY });
                const body = await limited.json();

                assertEqual(429, limited.status);
                assertEqual('TooManyFailedAttempts', body.errors[0].code);

                const retryAfter = Number(limited.headers.get('retry-after'));

                assert(
                    Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= WINDOW_SECONDS,
                    `expected Retry-After between 1 and ${ WINDOW_SECONDS }, got ${ limited.headers.get('retry-after') }`,
                );

                const accepted = await discover({ address: RATE_LIMITED_ADDRESS, key: requireDeployKey() });

                await accepted.arrayBuffer();

                assertEqual(200, accepted.status);
            });
        });
    }
});


// The key goes only in the Authorization header, and no assertion here
// holds it.
function discover({ address, key }) {
    const headers = { 'x-forwarded-for': address };

    if (key) {
        headers.authorization = `Bearer ${ key }`;
    }

    return fetch(`${ getBaseUrl() }${ DISCOVERY_PATHNAME }`, { headers, redirect: 'manual' });
}

function requireDeployKey() {
    const key = getDeployKey();

    assert(key !== null, 'INTEGRATION_TESTS_DEPLOY_KEY must be set');

    return key;
}

// A private address nothing else in the run uses.
function randomAddress() {
    const [ a, b, c ] = crypto.getRandomValues(new Uint8Array(3));

    return `10.${ a }.${ b }.${ c }`;
}
