import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createFakeDurableObjectNamespace } from '../../fakes/durable-object.js';
import { createFakeKVNamespace } from '../../fakes/workers-kv.js';
import ContentAddressableIndexStoreCore from '../../../kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js';
import KeyValueStore from '../../../kixx/adapters/cloudflare/key-value-store/lib/key-value-store.js';
import Logger from '../../../kixx/logger/logger.js';
import { PROBE_SUITES } from '../../../test-app/probe/probe-suites.js';
import { createPortFactories } from '../../../test-app/integration-probe/adapters/cloudflare/lib/port-factories.js';


// What core's manifest gives a Worker's content store by default.
const CONTENT_STORE_CONFIG = {
    blobReadCacheTtlSeconds: 86400,
    indexCacheTtlSeconds: 10,
    kvNamespace: { bindingName: 'CA_STORE_KV_STORE' },
    durableObject: { bindingName: 'CA_STORE_DURABLE_OBJECT' },
};


// A request context over fakes of the three bindings, with a clock the
// injected wait moves: Workers KV, and the fake, take one write per second
// to a key.
function makeTarget() {
    const clock = { now: Date.now() };
    const waits = [];
    let ids = 0;

    const keyValueNamespace = createFakeKVNamespace({ now: () => clock.now });
    const contentNamespace = createFakeKVNamespace({ now: () => clock.now });
    const durableObjectNames = [];

    const durableObjectNamespace = createFakeDurableObjectNamespace((state) => {
        return new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
    });

    const keyValueStore = new KeyValueStore();

    const context = {
        logger: new Logger({ name: 'Test', level: 'NONE' }),
        config: { env: { CONTENT_STORE: CONTENT_STORE_CONFIG } },
        env: {
            KEY_VALUE_STORE: keyValueNamespace,
            CA_STORE_KV_STORE: contentNamespace,
            CA_STORE_DURABLE_OBJECT: {
                getByName(name) {
                    durableObjectNames.push(name);
                    return durableObjectNamespace.getByName(name);
                },
            },
        },
        getService(name) {
            assertEqual('KeyValueStore', name);
            return keyValueStore;
        },
    };

    const portFactories = createPortFactories({
        async wait(milliseconds) {
            waits.push(milliseconds);
            clock.now += milliseconds;
        },
        createId: () => `id-${ ids += 1 }`,
    });

    return { context, portFactories, waits, keyValueNamespace, contentNamespace, durableObjectNames };
}


// The four port suites, run through the factories the test app's probe
// hands them on Cloudflare, over fakes. They first run on Cloudflare at M1.
describe('integration-probe: Cloudflare port factories', ({ describe, it }) => {
    const target = makeTarget();

    it('has a factory builder for each port suite, and no other', () => {
        assertEqual(
            'content-store,key-value-store,logger-writer,server-request',
            Object.keys(target.portFactories).sort().join(','),
        );
    });

    it('touches no binding when a builder is called', () => {
        const fresh = makeTarget();

        for (const build of Object.values(fresh.portFactories)) {
            assertEqual('function', typeof build(fresh.context));
        }

        assertEqual(0, fresh.keyValueNamespace.calls.length);
        assertEqual(0, fresh.contentNamespace.calls.length);
        assertEqual(0, fresh.durableObjectNames.length);
        assertEqual(0, fresh.waits.length);
    });

    for (const name of [ 'key-value-store', 'content-store', 'logger-writer', 'server-request' ]) {
        describe(name, ({ describe }) => {
            PROBE_SUITES[name](describe, target.portFactories[name](target.context));
        });
    }

    // A block's own tests run before its child blocks, so what the suites
    // did is checked in a block after them.
    describe('after the suites', ({ it }) => {
        it('waits out the one write a second Workers KV allows a key', () => {
            assert(target.waits.length > 0, 'expected the key/value suite to wait after a write');
            assertEqual('1100', [ ...new Set(target.waits) ].join(','));
        });

        it('gives each content store test a Durable Object of its own', () => {
            const names = new Set(target.durableObjectNames);

            assert(names.size > 1, 'expected one Durable Object per content store test');

            for (const name of names) {
                assert(/#probe-id-\d+$/.test(name), `unexpected Durable Object name ${ name }`);
            }
        });
    });
});
