import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ApplicationContext from '../../../kixx/context/application-context.js';
import HyperviewService from '../../../kixx/hyperview/hyperview-service.js';
import { register, initialize } from '../../../kixx/hyperview/plugin.js';
import { validatePluginManifest, resolveInstallation } from '../../../kixx/tooling/mod.js';


// The config defaults a generated registry carries: core's manifest holds
// them, and boot merges them under the project's config.
function readCoreConfigDefaults() {
    const filepath = fileURLToPath(new URL('../../../kixx/plugin.json', import.meta.url));
    const manifest = validatePluginManifest(JSON.parse(fs.readFileSync(filepath, 'utf8')), {
        file: 'kixx/plugin.json',
        isCore: true,
    });

    return resolveInstallation({ core: manifest, plugins: [] }).targets.node.configDefaults;
}

function makeApplicationContext(env) {
    return new ApplicationContext({
        config: { env: env ?? readCoreConfigDefaults() },
        logger: {
            createChild() {
                return { debug() {} };
            },
        },
        env: {},
        runtime: { mode: 'server' },
    });
}

// Records the pathnames HyperviewService delegates for validation, and rejects
// them all. Rejecting keeps the wiring assertion independent of everything the
// service would do next: the call is recorded, then the service's own assertion
// stops the render before it reaches content loading.
function makeContentAddressableStore() {
    const calls = [];
    return {
        calls,
        normalizePathname(pathname) {
            return pathname;
        },
        isValidPathname(pathname) {
            calls.push(pathname);
            return false;
        },
        async openSnapshot() {
            return {};
        },
    };
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


describe('hyperview plugin', ({ describe }) => {

    describe('register()', ({ it }) => {
        it('registers the HyperviewService', () => {
            const context = makeApplicationContext();

            register(context);

            assert(context.getService('HyperviewService') instanceof HyperviewService);
        });

        it('fails with the config path when the HYPERVIEW block is missing', () => {
            for (const env of [ {}, { HYPERVIEW: null }, { HYPERVIEW: 'on' } ]) {
                const context = makeApplicationContext(env);
                const caught = catchError(() => register(context));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('context.config.env.HYPERVIEW', caught.message);
            }
        });
    });

    describe('initialize()', ({ it }) => {
        it('wires Hyperview to the registered ContentAddressableStore', async () => {
            const context = makeApplicationContext();
            const contentAddressableStore = makeContentAddressableStore();
            context.registerService('ContentAddressableStore', contentAddressableStore);
            context.registerService('KeyValueStore', {});

            register(context);
            initialize(context);

            // HyperviewService delegates pathname validation to the store it was
            // initialized with, so driving a render through the service proves it
            // received this exact instance rather than one built separately.
            const hyperviewService = context.getService('HyperviewService');
            const caught = await catchAsyncError(
                () => hyperviewService.renderPage({}, {
                    url: new URL('https://example.com/welcome'),
                    props: {},
                    pathname: '/welcome',
                }),
            );

            assert(caught, 'expected the rejected pathname to throw');
            assertEqual('AssertionError', caught.name);
            assertEqual(1, contentAddressableStore.calls.length);
            assertEqual('/welcome', contentAddressableStore.calls[0]);
        });

        it('fails clearly when ContentAddressableStore is not registered', () => {
            const context = makeApplicationContext();
            context.registerService('KeyValueStore', {});

            register(context);

            const caught = catchError(() => initialize(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('ContentAddressableStore'),
                `expected "ContentAddressableStore" in "${ caught.message }"`,
            );
        });

        it('fails clearly when KeyValueStore is not registered', () => {
            const context = makeApplicationContext();
            context.registerService('ContentAddressableStore', makeContentAddressableStore());

            register(context);

            const caught = catchError(() => initialize(context));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assert(
                caught.message.includes('KeyValueStore'),
                `expected "KeyValueStore" in "${ caught.message }"`,
            );
        });
    });
});
