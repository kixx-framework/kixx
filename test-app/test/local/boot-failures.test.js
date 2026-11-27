/**
 * What a real server process does at boot with a missing or malformed
 * deploy key hash (CORE-2, CORE-3), on the runtime the runner runs on.
 */
import { assert, assertEqual, assertFalsy } from 'kixx-assert';
import { describeOnTarget } from '../test-helpers/target.js';
import { startLocalServer, tail } from '../test-helpers/local-server.js';


// Every deploy key starts with this.
const DEPLOY_KEY_PREFIX = 'kxdk_';


describeOnTarget([ 'local' ], 'local: boot failures', ({ it }) => {
    it('exits non-zero in production with no DEPLOY_KEY_HASH, and names the secret', async () => {
        const server = await startLocalServer({ deployKey: null, wait: false });

        try {
            const exit = await server.exitWithin(7000);

            assert(exit, 'the server was still running after 7 seconds');
            assert(Number.isInteger(exit.code) && exit.code !== 0, `expected a non-zero exit code, got ${ exit.code }`);
            assert(exit.output.includes('DEPLOY_KEY_HASH'), `the output doesn't name the secret:\n${ tail(exit.output) }`);
            assertFalsy(exit.output.includes(DEPLOY_KEY_PREFIX), 'the output holds something shaped like a deploy key');
        } finally {
            await server.close();
        }
    });

    it('exits non-zero with a malformed DEPLOY_KEY_HASH, naming the secret and never its value', async () => {
        // Made up, and not a hash: too short, and not hex.
        const malformed = `malformed-${ crypto.randomUUID() }`;
        const server = await startLocalServer({ deployKeyHash: malformed, wait: false });

        try {
            const exit = await server.exitWithin(7000);

            assert(exit, 'the server was still running after 7 seconds');
            assert(Number.isInteger(exit.code) && exit.code !== 0, `expected a non-zero exit code, got ${ exit.code }`);

            // Not tail(): the message must not show the output if the value is in it.
            assertFalsy(exit.output.includes(malformed), 'the output holds the value of DEPLOY_KEY_HASH');
            assert(exit.output.includes('DEPLOY_KEY_HASH'), `the output doesn't name the secret:\n${ tail(exit.output) }`);
            assertFalsy(exit.output.includes(DEPLOY_KEY_PREFIX), 'the output holds something shaped like a deploy key');
        } finally {
            await server.close();
        }
    });

    // S09 OP1: in development the deploy key is open.
    it('boots in development with no DEPLOY_KEY_HASH and no BUILD_ID', async () => {
        const server = await startLocalServer({ environment: 'development', deployKey: null, buildId: null });

        try {
            const response = await server.fetch('/integration-probe/environment');
            const body = await response.json();

            assertEqual(200, response.status);
            assertEqual('development', body.environment);
            assertEqual(null, body.buildId);

            const exit = await server.close();

            assertEqual(0, exit.code, tail(exit.output));
        } finally {
            await server.close();
        }
    });
});
