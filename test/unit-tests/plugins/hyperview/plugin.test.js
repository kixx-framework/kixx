import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ApplicationContext from '../../../../src/kixx/context/application-context.js';
import HyperviewService from '../../../../src/kixx/hyperview/hyperview-service.js';
import HyperviewContentService from '../../../../src/kixx/hyperview/hyperview-content-service.js';
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

function makeContentAddressableStore() {
    const calls = [];
    return {
        calls,
        async hashValue(value) {
            calls.push(value);
            return `hashed:${ value }`;
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


describe('hyperview plugin', ({ describe }) => {

    describe('register()', ({ it }) => {
        it('registers HyperviewContent and Hyperview services', () => {
            const context = makeApplicationContext();

            register(context);

            assert(context.getService('HyperviewContent') instanceof HyperviewContentService);
            assert(context.getService('Hyperview') instanceof HyperviewService);
        });
    });

    describe('initialize()', ({ it }) => {
        it('wires HyperviewContent to the registered ContentAddressableStore', async () => {
            const context = makeApplicationContext();
            const contentStore = makeContentAddressableStore();
            context.registerService('ContentAddressableStore', contentStore);
            context.registerService('KeyValueStore', {});

            register(context);
            initialize(context);

            const hyperviewContent = context.getService('HyperviewContent');
            const result = await hyperviewContent.hashValue('abc');

            assertEqual('hashed:abc', result);
            assertEqual(1, contentStore.calls.length);
            assertEqual('abc', contentStore.calls[0]);
        });

        it('wires Hyperview to the same HyperviewContent instance it registered', () => {
            const context = makeApplicationContext();
            context.registerService('ContentAddressableStore', makeContentAddressableStore());
            context.registerService('KeyValueStore', {});

            register(context);

            // Replace one method on the already-registered HyperviewContent
            // instance with a spy before initialize() runs. Because
            // initialize() passes this exact object by reference into
            // HyperviewService#initialize(), the spy proves Hyperview's
            // content-service dependency is this instance and not a
            // separately constructed one, regardless of wiring order.
            const hyperviewContent = context.getService('HyperviewContent');
            const calls = [];
            hyperviewContent.isValidPathname = (value) => {
                calls.push(value);
                return true;
            };

            initialize(context);

            const hyperviewService = context.getService('Hyperview');
            const result = hyperviewService.isValidPathname('/articles');

            assertEqual(true, result);
            assertEqual(1, calls.length);
            assertEqual('/articles', calls[0]);
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
