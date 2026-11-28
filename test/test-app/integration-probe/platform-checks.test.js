import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createFakeDurableObjectNamespace, createFakeDurableObjectState } from '../../fakes/durable-object.js';
import { createFakeKVNamespace } from '../../fakes/workers-kv.js';
import IntegrationProbeSqlStoreCore from '../../../test-app/integration-probe/adapters/cloudflare/lib/integration-probe-sql-store-core.js';
import { createPlatformChecks } from '../../../test-app/integration-probe/adapters/cloudflare/lib/platform-checks.js';
import {
    PLATFORM_CHECK_NAMES,
    PLATFORM_EXPECTATIONS,
    comparePlatformObservation,
} from '../../../test-app/integration-probe/lib/platform-expectations.js';
import { observe } from '../../../test-app/integration-probe/lib/platform-observation.js';


// A fixed time, half way through a second.
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0, 500);

const BOOT_NAMES = [ 'DEPLOY_KEY_HASH', 'ENVIRONMENT', 'INTEGRATION_PROBE_SQL_STORE', 'KEY_VALUE_STORE' ];


// The checks over the fakes, as the Cloudflare lifecycle module builds them
// over the real bindings.
function makeSubject({ now = () => NOW } = {}) {
    const namespace = createFakeKVNamespace({ now });
    const objects = [];

    const sqlStore = createFakeDurableObjectNamespace((state) => {
        objects.push(state);
        return new IntegrationProbeSqlStoreCore({ ctx: state, env: {} });
    });

    let ids = 0;

    const checks = createPlatformChecks({
        now,
        createId: () => `id-${ ids += 1 }`,
        bootEnvironmentNames: BOOT_NAMES,
    });

    const context = {
        env: {
            DEPLOY_KEY_HASH: 'never-read',
            ENVIRONMENT: 'production',
            KEY_VALUE_STORE: namespace,
            INTEGRATION_PROBE_SQL_STORE: sqlStore,
        },
        config: {
            env: {
                KEY_VALUE_STORE: { bindingName: 'KEY_VALUE_STORE' },
                INTEGRATION_PROBE: { durableObject: { bindingName: 'INTEGRATION_PROBE_SQL_STORE' } },
            },
        },
    };

    return { checks, context, namespace, objects };
}


describe('integration-probe: platform checks against the fakes', ({ describe, it }) => {

    it('has an expectation for every check, and a check for every expectation', () => {
        const { checks } = makeSubject();

        assertEqual(PLATFORM_CHECK_NAMES.slice().sort().join('\n'), Object.keys(checks).sort().join('\n'));
    });

    it('touches no binding until a check is called', () => {
        const { namespace, objects } = makeSubject();

        assertEqual(0, namespace.calls.length);
        assertEqual(0, objects.length);
    });

    // The point of this file: the fakes answer each check as the
    // expectations say. The Cloudflare integration test asks the platform.
    describe('every check reports what its expectation says', ({ it }) => {
        for (const name of PLATFORM_CHECK_NAMES) {
            it(name, async () => {
                const { checks, context } = makeSubject();
                const observation = await checks[name](context);

                assertEqual('', comparePlatformObservation(name, observation).join('; '));
            });
        }
    });

    describe('the key/value checks', ({ it }) => {
        it('write every key with an expiration, under the plugin\'s own prefix', async () => {
            const { checks, context, namespace } = makeSubject();

            for (const name of PLATFORM_CHECK_NAMES.filter((candidate) => candidate.startsWith('kv-'))) {
                await checks[name](context);
            }

            const puts = namespace.calls.filter(({ method }) => method === 'put');

            assert(puts.length >= 5);

            for (const { key, options } of puts) {
                assertMatches(/^integration-probe:platform-check:/, key);
                assert(options.expiration !== undefined || options.expirationTtl !== undefined, `${ key } never expires`);
            }
        });

        it('use a key of their own on every call', async () => {
            const { checks, context, namespace } = makeSubject();

            await checks['kv-put-array-buffer-view'](context);
            await checks['kv-put-array-buffer-view'](context);

            const keys = namespace.calls.filter(({ method }) => method === 'put').map(({ key }) => key);

            assertEqual(2, new Set(keys).size);
        });

        it('aim the short expiration at a whole second, 59 to 60 seconds away', async () => {
            for (const milliseconds of [ 0, 1, 500, 999 ]) {
                const now = () => NOW - 500 + milliseconds;
                const { checks, context, namespace } = makeSubject({ now });

                await checks['kv-put-expiration-under-60-seconds'](context);

                const { expiration } = namespace.calls.at(-1).options;
                const secondsAway = expiration - (now() / 1000);

                assert(Number.isInteger(expiration), `${ expiration } is no whole second`);
                assert(secondsAway >= 59 && secondsAway < 60, `${ secondsAway } seconds away at ${ milliseconds } ms`);
            }
        });

        it('report the second write only: a first write that fails is thrown', async () => {
            const { checks, context } = makeSubject();

            context.env.KEY_VALUE_STORE = {
                async put() {
                    throw new Error('the first write failed');
                },
            };

            let thrown = null;

            try {
                await checks['kv-put-twice-within-a-second'](context);
            } catch (error) {
                thrown = error;
            }

            assertEqual('the first write failed', thrown?.message);
        });
    });

    describe('the environment check', ({ it }) => {
        it('names what the request\'s environment lacks, and what it adds, and never a value', async () => {
            const { checks, context } = makeSubject();

            delete context.env.ENVIRONMENT;
            context.env.ADDED_LATER = 'a-value-never-shown';

            const observation = await checks['environment-bindings'](context);

            assertEqual(
                JSON.stringify({ missingFromRequest: [ 'ENVIRONMENT' ], missingFromBoot: [ 'ADDED_LATER' ] }),
                JSON.stringify(observation.value),
            );
            assertEqual(1, comparePlatformObservation('environment-bindings', observation).length);
        });
    });

    describe('the sql.exec checks', ({ it }) => {
        it('run in one Durable Object instance, and leave no row behind', async () => {
            const { checks, context, objects } = makeSubject();

            for (const name of IntegrationProbeSqlStoreCore.checkNames) {
                await checks[name](context);
            }

            assertEqual(1, objects.length);

            const [ { rows } ] = objects[0].storage.sql.exec('SELECT COUNT(*) AS rows FROM platform_checks').toArray();

            assertEqual(0, rows);
        });

        // Every size the checks try is over the fake's limit. A smaller
        // one follows the path a looser platform takes.
        it('store a BLOB the storage takes, report its size, and remove the row', async () => {
            const state = createFakeDurableObjectState();
            const core = new IntegrationProbeSqlStoreCore({ ctx: state, blobSizes: { 'sql-blob-2000001-bytes': 1000 } });

            const observation = await core.runCheck('sql-blob-2000001-bytes', 'id-1');

            assertEqual(JSON.stringify({ outcome: 'resolved', value: { storedBytes: 1000 } }), JSON.stringify(observation));

            const [ { rows } ] = state.storage.sql.exec('SELECT COUNT(*) AS rows FROM platform_checks').toArray();

            assertEqual(0, rows);

            // A measurement: the comparison still names the difference.
            assertEqual(1, comparePlatformObservation('sql-blob-2000001-bytes', observation).length);
        });

        it('throw for a name that is no check', async () => {
            const { context } = makeSubject();
            const stub = context.env.INTEGRATION_PROBE_SQL_STORE.getByName('any');

            let thrown = null;

            try {
                await stub.runCheck('no-such-check', 'id-1');
            } catch (error) {
                thrown = error;
            }

            assertMatches('Unknown platform check: no-such-check', thrown?.message);
        });
    });

    describe('comparePlatformObservation()', ({ it }) => {
        it('reports an outcome that differs, with what happened', () => {
            const [ difference, ...rest ] = comparePlatformObservation('kv-get-empty-array', { outcome: 'resolved', value: { size: 0 } });

            assertEqual(0, rest.length);
            assertMatches('expected the call to be rejected, and it was resolved ({"size":0})', difference);
        });

        it('reports a value that differs', () => {
            const differences = comparePlatformObservation('kv-put-array-buffer-view', {
                outcome: 'resolved',
                value: { storedBytes: [ 9, 1, 2, 3, 9 ] },
            });

            assertEqual(1, differences.length);
            assertMatches('[9,1,2,3,9]', differences[0]);
        });

        it('reports a documented message that is missing', () => {
            const differences = comparePlatformObservation('kv-put-twice-within-a-second', {
                outcome: 'rejected',
                errorName: 'Error',
                message: 'KV PUT failed: 500',
            });

            assertEqual(1, differences.length);
            assertMatches('KV PUT failed: 429 Too Many Requests', differences[0]);
        });

        it('throws for a name with no expectation', () => {
            let thrown = null;

            try {
                comparePlatformObservation('toString', { outcome: 'resolved' });
            } catch (error) {
                thrown = error;
            }

            assertMatches('No platform expectation is named toString', thrown?.message);
        });

        it('marks only the row-limit checks as measurements', () => {
            const measurements = PLATFORM_CHECK_NAMES.filter((name) => PLATFORM_EXPECTATIONS[name].measurement);

            assertEqual(
                'sql-blob-2000001-bytes,sql-blob-4194304-bytes,sql-blob-8000000-bytes,sql-blob-8388609-bytes',
                measurements.join(','),
            );
        });
    });

    describe('observe()', ({ it }) => {
        it('reports a resolved value, and null for none', async () => {
            assertEqual(JSON.stringify({ outcome: 'resolved', value: 7 }), JSON.stringify(await observe(async () => 7)));
            assertEqual(JSON.stringify({ outcome: 'resolved', value: null }), JSON.stringify(await observe(() => undefined)));
        });

        it('reports a throw by its name and message, cut to 500 characters', async () => {
            const observation = await observe(() => {
                throw new TypeError('x'.repeat(600));
            });

            assertEqual('rejected', observation.outcome);
            assertEqual('TypeError', observation.errorName);
            assertEqual(500, observation.message.length);
        });
    });
}, { timeout: 5000 });
