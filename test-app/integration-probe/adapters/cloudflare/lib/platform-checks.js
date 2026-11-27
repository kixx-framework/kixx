// The integration suite's platform checks for Cloudflare: each runs one
// call against a real binding, inside the Worker, and reports what happened
// (see lib/platform-observation.js). lib/platform-expectations.js holds what
// each should report. A unit test runs them against the fakes in
// test/fakes/, and the Cloudflare integration test against the platform.
//
// Each check uses a key or rows of its own, so one request never meets
// another's. Every key is written with an expiration, so none is left for
// good.
//
// Documentation read 2026-11-27:
// - https://developers.cloudflare.com/kv/api/write-key-value-pairs/
// - https://developers.cloudflare.com/kv/api/read-key-value-pairs/
// - https://developers.cloudflare.com/kv/platform/limits/
// - https://developers.cloudflare.com/workers/runtime-apis/bindings/
import { observe } from '../../../lib/platform-observation.js';
import IntegrationProbeSqlStoreCore from './integration-probe-sql-store-core.js';


const KEY_PREFIX = 'integration-probe:platform-check';

// The shortest expiration Workers KV takes, in seconds.
const MIN_EXPIRATION_SECONDS = 60;

// One instance runs every SQL check, so a run leaves one behind.
const SQL_STORE_INSTANCE_NAME = 'integration-probe-platform-checks';


/**
 * Returns the checks, by name. Each takes the request's context and
 * resolves an observation. Nothing is touched until a check is called.
 *
 * @param {Object} options
 * @param {function(): number} options.now - Milliseconds since the epoch
 * @param {function(): string} options.createId - Returns a new unique id on each call
 * @param {string[]} options.bootEnvironmentNames - The names in the module-scope environment the Worker booted with. Names only.
 * @returns {Object<string, function(Object): Promise<Object>>}
 */
export function createPlatformChecks({ now, createId, bootEnvironmentNames }) {
    function getNamespace(context) {
        return context.env[context.config.env.KEY_VALUE_STORE.bindingName];
    }

    function createKey(name) {
        return `${ KEY_PREFIX }:${ name }:${ createId() }`;
    }

    const checks = {
        // The documentation lists string, ReadableStream, and ArrayBuffer
        // for a value, and no view. The view here is a window on a larger
        // buffer, so the answer also shows whether only the window is
        // stored.
        'kv-put-array-buffer-view'(context) {
            const namespace = getNamespace(context);
            const key = createKey('view');
            const view = new Uint8Array(new Uint8Array([ 9, 1, 2, 3, 9 ]).buffer, 1, 3);

            return observe(async () => {
                await namespace.put(key, view, { expirationTtl: MIN_EXPIRATION_SECONDS });

                return { storedBytes: Array.from(new Uint8Array(await namespace.get(key, 'arrayBuffer'))) };
            });
        },

        // The documentation gives a maximum of 100 keys and no minimum.
        'kv-get-empty-array'(context) {
            const namespace = getNamespace(context);

            return observe(async () => ({ size: (await namespace.get([])).size }));
        },

        // The documentation describes each option and says nothing of
        // passing both.
        'kv-put-expiration-and-ttl'(context) {
            const namespace = getNamespace(context);
            const key = createKey('both');
            const expiration = Math.floor(now() / 1000) + 120;

            return observe(async () => {
                await namespace.put(key, 'both', { expiration, expirationTtl: 120 });

                return { stored: true };
            });
        },

        // Documented: "Expiration targets that are less than 60 seconds
        // into the future are not supported." The target here is a whole
        // second, at least 59 and less than 60 seconds away, so the answer
        // shows how exactly the platform counts.
        'kv-put-expiration-under-60-seconds'(context) {
            const namespace = getNamespace(context);
            const key = createKey('soon');
            const expiration = Math.floor((now() + 59999) / 1000);

            return observe(async () => {
                await namespace.put(key, 'soon', { expiration });

                return { stored: true };
            });
        },

        // Documented: one write a second to a key, and a second one "will
        // cause rate limiting (429) errors to be thrown", with the message
        // "KV PUT failed: 429 Too Many Requests" in the page's example. The
        // content store adapter matches that text (S08 OP1).
        async 'kv-put-twice-within-a-second'(context) {
            const namespace = getNamespace(context);
            const key = createKey('twice');

            // Not observed: the check is about the second write.
            await namespace.put(key, 'first', { expirationTtl: MIN_EXPIRATION_SECONDS });

            return observe(async () => {
                await namespace.put(key, 'second', { expirationTtl: MIN_EXPIRATION_SECONDS });

                return { stored: true };
            });
        },

        // The entry point boots with the `env` it imports from
        // cloudflare:workers, and the runtime hands fetch() an environment
        // on every request. The documentation doesn't say they are one
        // object. Names only: never a value.
        'environment-bindings'(context) {
            return observe(() => {
                const requestNames = Object.keys(context.env);

                return {
                    missingFromRequest: bootEnvironmentNames.filter((name) => !requestNames.includes(name)).sort(),
                    missingFromBoot: requestNames.filter((name) => !bootEnvironmentNames.includes(name)).sort(),
                };
            });
        },
    };

    // The sql.exec checks run inside the test-only Durable Object.
    for (const name of IntegrationProbeSqlStoreCore.checkNames) {
        checks[name] = (context) => {
            const { bindingName } = context.config.env.INTEGRATION_PROBE.durableObject;

            return context.env[bindingName].getByName(SQL_STORE_INSTANCE_NAME).runCheck(name, createId());
        };
    }

    return checks;
}
