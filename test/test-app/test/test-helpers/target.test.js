import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    describeOnTarget,
    fetchWithDeployKey,
    getBaseUrl,
    getDeployKey,
    getTarget,
} from '../../../../test-app/test/test-helpers/target.js';


const VARIABLES = [
    'INTEGRATION_TESTS_BASE_URL',
    'INTEGRATION_TESTS_DEPLOY_KEY',
    'INTEGRATION_TESTS_TARGET',
];

// A block is registered while its file is imported, so describeOnTarget()
// is called here, with the target set for the length of the call. The
// tests below look at what it registered.
const registered = [];

withEnvironment({ INTEGRATION_TESTS_TARGET: 'local' }, () => {
    describeOnTarget([ 'local', 'nodejs' ], 'describeOnTarget() on a target it names', ({ it }) => {
        registered.push('named');

        it('registers the block', () => {
            assert(registered.includes('named'));
        });
    });

    describeOnTarget([ 'cloudflare' ], 'describeOnTarget() on another target', () => {
        registered.push('other');
    });
});

withEnvironment({}, () => {
    describeOnTarget([ 'local', 'cloudflare', 'nodejs' ], 'describeOnTarget() on a target given by URL', () => {
        registered.push('unnamed');
    });
});


describe('test-app/test/test-helpers/target.js', ({ describe }) => {

    describe('getBaseUrl()', ({ it }) => {
        it('returns the base URL without a trailing slash', () => {
            withEnvironment({ INTEGRATION_TESTS_BASE_URL: 'http://localhost:2026/' }, () => {
                assertEqual('http://localhost:2026', getBaseUrl());
            });
        });

        it('throws when no base URL is set', () => {
            const caught = withEnvironment({}, () => catchError(getBaseUrl));

            assertEqual('AssertionError', caught.name);
            assertMatches('INTEGRATION_TESTS_BASE_URL', caught.message);
        });
    });

    describe('getDeployKey()', ({ it }) => {
        it('returns the key, or null when none is set', () => {
            withEnvironment({ INTEGRATION_TESTS_DEPLOY_KEY: 'made-up-key' }, () => {
                assertEqual('made-up-key', getDeployKey());
            });

            withEnvironment({}, () => {
                assertEqual(null, getDeployKey());
            });
        });
    });

    describe('getTarget()', ({ it }) => {
        it('returns the name of a named target', () => {
            for (const name of [ 'local', 'cloudflare', 'nodejs' ]) {
                withEnvironment({ INTEGRATION_TESTS_TARGET: name }, () => {
                    assertEqual(name, getTarget());
                });
            }
        });

        it('returns null for a target given by URL', () => {
            withEnvironment({}, () => {
                assertEqual(null, getTarget());
            });
        });

        it('returns null for a name the runner does not know', () => {
            withEnvironment({ INTEGRATION_TESTS_TARGET: 'toaster' }, () => {
                assertEqual(null, getTarget());
            });
        });
    });

    describe('describeOnTarget()', ({ it }) => {
        it('registers a block only on a target it names', () => {
            assertEqual('["named"]', JSON.stringify(registered));
        });

        it('refuses a target name the runner does not know', () => {
            const caught = catchError(() => describeOnTarget([ 'toaster' ], 'never', () => {}));

            assertEqual('AssertionError', caught.name);
            assertMatches('local, cloudflare, nodejs', caught.message);
        });

        it('refuses an empty list of targets', () => {
            const caught = catchError(() => describeOnTarget([], 'never', () => {}));

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('fetchWithDeployKey()', ({ it }) => {
        // No test here reaches fetch(): each fails before a request is made.
        it('refuses to send a request when no key is set', async () => {
            const caught = await withEnvironment(
                { INTEGRATION_TESTS_BASE_URL: 'http://127.0.0.1:9/' },
                () => catchAsyncError(() => fetchWithDeployKey('/protected')),
            );

            assertEqual('AssertionError', caught.name);
            assertMatches('INTEGRATION_TESTS_DEPLOY_KEY', caught.message);
        });

        it('refuses a path with no leading slash, without showing the key', async () => {
            const caught = await withEnvironment(
                { INTEGRATION_TESTS_BASE_URL: 'http://127.0.0.1:9/', INTEGRATION_TESTS_DEPLOY_KEY: 'made-up-key' },
                () => catchAsyncError(() => fetchWithDeployKey('protected')),
            );

            assertEqual('AssertionError', caught.name);
            assertFalsy(caught.message.includes('made-up-key'));
        });
    });
});


// Calls fn with the integration variables set to exactly `values`, and puts
// back what the developer's shell had. fn must read them before it returns
// or awaits.
function withEnvironment(values, fn) {
    const saved = VARIABLES.map((name) => [ name, process.env[name] ]);

    for (const name of VARIABLES) {
        delete process.env[name];
    }

    Object.assign(process.env, values);

    try {
        return fn();
    } finally {
        for (const [ name, value ] of saved) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
