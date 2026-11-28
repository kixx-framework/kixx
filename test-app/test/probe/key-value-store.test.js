/**
 * Runs the `key-value-store` conformance suite inside the target, one remote test
 * per local test (see "The Probe" in test-app/README.md).
 */
import { describe } from 'kixx-test';
import { createProbeClient, describeProbeSuite } from '../../probe/probe-client.js';
import { getBaseUrl, getDeployKey } from '../test-helpers/target.js';


const SUITE = 'key-value-store';

const client = createProbeClient({
    url: `${ getBaseUrl() }/integration-probe/probe`,
    deployKey: getDeployKey(),
});

// The tests must be known before they can be registered, so list them while
// the file is imported.
const tests = await client.listTests(SUITE);

describeProbeSuite(describe, { client, suite: SUITE, tests });
