/**
 * Cloudflare only. Each platform check runs one call against a real Workers
 * KV namespace or SQLite Durable Object, inside the Worker, and reports what
 * happened. This file compares each report with
 * integration-probe/lib/platform-expectations.js, which holds what the
 * unit suite's fakes do. The unit suite runs the same checks against the
 * fakes and compares them with the same module.
 *
 * So a failure here names a fake that differs from the platform. Fix the
 * fake, then the expectation, and pin the difference with a unit test.
 *
 * A row-limit check doesn't fail on a looser platform: the fake is stricter
 * on purpose (S06 OP3). Its answer is printed as a measurement.
 */
import { assertEqual } from 'kixx-assert';
import { PLATFORM_CHECK_NAMES, PLATFORM_EXPECTATIONS, comparePlatformObservation } from '../../integration-probe/lib/platform-expectations.js';
import { describeOnTarget, fetchWithDeployKey } from '../test-helpers/target.js';
import { report } from '../test-helpers/local-server.js';


const PLATFORM_CHECKS_PATHNAME = '/integration-probe/platform-checks';


describeOnTarget([ 'cloudflare' ], 'cloudflare: platform checks', ({ it }) => {
    for (const name of PLATFORM_CHECK_NAMES) {
        it(name, async () => {
            const response = await fetchWithDeployKey(`${ PLATFORM_CHECKS_PATHNAME }/${ name }`, { method: 'POST' });
            const text = await response.text();

            assertEqual(200, response.status, text.slice(0, 300));

            const { observation } = JSON.parse(text);
            const differences = comparePlatformObservation(name, observation);

            // An observation holds no secret: a check reports names,
            // counts, and the platform's own error text.
            report(`[cloudflare: platform checks] ${ name }: ${ JSON.stringify(observation) }`);

            if (PLATFORM_EXPECTATIONS[name].measurement) {
                return;
            }

            assertEqual('', differences.join('; '));
        });
    }
});
