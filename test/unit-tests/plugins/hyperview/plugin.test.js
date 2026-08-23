import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ApplicationContext from '../../../../src/kixx/context/application-context.js';
import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';
import { register, initialize } from '../../../../src/plugins/hyperview/plugin.js';


function makeApplicationContext(env) {
    return new ApplicationContext({
        config: { env: env ?? {} },
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
        it('registers the Hyperview service', () => {
            const context = makeApplicationContext();

            register(context);

            assert(context.getService('Hyperview') instanceof HyperviewService);
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
            const hyperviewService = context.getService('Hyperview');
            const caught = await catchAsyncError(
                () => hyperviewService.renderEmail({}, '/welcome', {}),
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
