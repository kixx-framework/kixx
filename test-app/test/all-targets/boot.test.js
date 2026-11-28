/**
 * The test app is up, runs with production settings, and keeps its test
 * routes behind the deploy key. Every other integration test depends on it.
 */
import { describe } from 'kixx-test';
import { assert, assertEqual, isNonEmptyString } from 'kixx-assert';
import { fetchWithDeployKey, getBaseUrl, getTarget } from '../test-helpers/target.js';


const ENVIRONMENT_PATH = '/integration-probe/environment';

// The test app names the adapters it runs on. It can't tell a laptop from a
// host, or Node.js from Deno.
const ADAPTER_OF_TARGET = {
    local: 'node',
    nodejs: 'node',
    cloudflare: 'cloudflare',
};


describe('boot', ({ it }) => {
    it('answers its target, environment, and build with the deploy key', async () => {
        const response = await fetchWithDeployKey(ENVIRONMENT_PATH);

        assertEqual(200, response.status);

        const body = await response.json();
        const target = getTarget();

        if (target) {
            assertEqual(ADAPTER_OF_TARGET[target], body.target);
        } else {
            // A target given by URL: either adapter may be behind it.
            assert(
                Object.values(ADAPTER_OF_TARGET).includes(body.target),
                `expected a known adapter name, got ${ body.target }`,
            );
        }

        assertEqual('production', body.environment);
        assert(isNonEmptyString(body.buildId), 'expected a non-empty buildId');
    });

    it('refuses a request without the deploy key', async () => {
        const response = await fetch(`${ getBaseUrl() }${ ENVIRONMENT_PATH }`, { redirect: 'manual' });

        assertEqual(401, response.status);

        const body = await response.json();

        assertEqual('DeployKeyRequired', body.errors[0].code);
    });
});
