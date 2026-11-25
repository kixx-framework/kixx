import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createFakeDurableObjectNamespace } from '../../../../fakes/durable-object.js';
import { createFakeKVNamespace } from '../../../../fakes/workers-kv.js';
import ApplicationContext from '../../../../../kixx/context/application-context.js';
import ContentStore from '../../../../../kixx/adapters/cloudflare/content-store/lib/content-store.js';
import ContentAddressableIndexStoreCore from '../../../../../kixx/adapters/cloudflare/content-store/lib/content-addressable-index-store-core.js';
import { register } from '../../../../../kixx/adapters/cloudflare/content-store/plugin.js';
import { validatePluginManifest, resolveInstallation } from '../../../../../kixx/tooling/mod.js';


const SILENT_LOGGER = {
    info() {},
    warn() {},
    debug() {},
    createChild() {
        return SILENT_LOGGER;
    },
};


// The Cloudflare config defaults a generated registry carries: core's manifest
// holds them, and boot merges them under the project's config. A fresh,
// unfrozen copy each time, so a test can take a value out.
function readCloudflareConfigDefaults() {
    const filepath = fileURLToPath(new URL('../../../../../kixx/plugin.json', import.meta.url));
    const manifest = validatePluginManifest(JSON.parse(fs.readFileSync(filepath, 'utf8')), {
        file: 'kixx/plugin.json',
        isCore: true,
    });
    const { configDefaults } = resolveInstallation({ core: manifest, plugins: [] }).targets.cloudflare;

    return structuredClone(configDefaults);
}

function makeApplicationContext(env) {
    return new ApplicationContext({
        config: { env },
        logger: SILENT_LOGGER,
        env: {},
        runtime: { mode: 'server' },
    });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('cloudflare content store plugin', ({ describe }) => {

    describe('register()', ({ it }) => {
        it('registers the ContentStore from the manifest\'s config defaults', () => {
            const context = makeApplicationContext(readCloudflareConfigDefaults());

            register(context);

            assert(context.getService('ContentStore') instanceof ContentStore);
        });

        it('reads and writes through the bindings under the default binding names', async () => {
            const context = makeApplicationContext(readCloudflareConfigDefaults());

            register(context);

            const kvStore = createFakeKVNamespace();
            const durableObjectNamespace = createFakeDurableObjectNamespace((state) => {
                return new ContentAddressableIndexStoreCore({ ctx: state, env: {} });
            });

            // The store takes its bindings from each request's environment.
            const requestContext = {
                logger: SILENT_LOGGER,
                env: {
                    CA_STORE_KV_STORE: kvStore,
                    CA_STORE_DURABLE_OBJECT: durableObjectNamespace,
                },
            };

            const store = context.getService('ContentStore');

            await store.putFile(requestContext, '/a.txt', 'hash-a', 'hello');

            assertEqual('hello', await store.getFile(requestContext, 'text', '/a.txt', 'hash-a'));
            assertEqual('put,get', kvStore.calls.map((call) => call.method).join(','));
            assertEqual(null, await store.getBuildPointer(requestContext, 'build-1'));
        });

        it('fails with the config path of each missing value', () => {
            const cases = [
                [ 'CONTENT_STORE.kvNamespace.bindingName', (env) => delete env.CONTENT_STORE.kvNamespace.bindingName ],
                [ 'CONTENT_STORE.durableObject.bindingName', (env) => delete env.CONTENT_STORE.durableObject.bindingName ],
                [ 'CONTENT_STORE.blobReadCacheTtlSeconds', (env) => delete env.CONTENT_STORE.blobReadCacheTtlSeconds ],
                [ 'CONTENT_STORE.indexCacheTtlSeconds', (env) => delete env.CONTENT_STORE.indexCacheTtlSeconds ],
                [ 'CONTENT_STORE.kvNamespace.bindingName', (env) => delete env.CONTENT_STORE.kvNamespace ],
                [ 'CONTENT_STORE.kvNamespace.bindingName', (env) => delete env.CONTENT_STORE ],
            ];

            for (const [ configPath, remove ] of cases) {
                const env = readCloudflareConfigDefaults();

                remove(env);

                const context = makeApplicationContext(env);
                const caught = catchError(() => register(context));

                assert(caught, `expected an error without ${ configPath }`);
                assertEqual('AssertionError', caught.name);
                assert(
                    caught.message.includes(`cloudflare content store requires context.config.env.${ configPath }`),
                    `expected "${ configPath }" in "${ caught.message }"`,
                );
            }
        });
    });
});
