import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { readWorkingTreeSwitch } from '../../../kixx/content-addressable-store/working-tree-switch.js';
import { register } from '../../../kixx/content-addressable-store/plugin.js';


function makeConfig(environment, contentStore) {
    return { environment, env: contentStore === undefined ? {} : { CONTENT_STORE: contentStore } };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('working tree switch', ({ describe }) => {

    describe('readWorkingTreeSwitch()', ({ it }) => {
        it('is on in development when the key is absent', () => {
            assertEqual(true, readWorkingTreeSwitch(makeConfig('development')));
            assertEqual(true, readWorkingTreeSwitch(makeConfig('development', {})));
            assertEqual(true, readWorkingTreeSwitch(makeConfig('development', { rootDirectory: './store' })));
        });

        it('is on in development when the key is true', () => {
            assertEqual(true, readWorkingTreeSwitch(makeConfig('development', { workingTree: true })));
        });

        it('is off when the key is false, in any environment', () => {
            assertEqual(false, readWorkingTreeSwitch(makeConfig('development', { workingTree: false })));
            assertEqual(false, readWorkingTreeSwitch(makeConfig('production', { workingTree: false })));
        });

        it('is off outside development when the key is absent', () => {
            for (const environment of [ 'production', 'test', 'staging', 'Development', undefined ]) {
                assertEqual(false, readWorkingTreeSwitch(makeConfig(environment)));
            }

            assertEqual(false, readWorkingTreeSwitch(undefined));
        });

        it('refuses true outside development, naming the key and the environment', () => {
            const error = catchError(() => readWorkingTreeSwitch(makeConfig('production', { workingTree: true })));

            assert(error, 'expected an error to be thrown');
            assertEqual('OperationalError', error.name);
            assertMatches('CONTENT_STORE.workingTree', error.message);
            assertMatches('"production"', error.message);
            assertMatches('development', error.message);
        });

        it('refuses a value that is not a boolean, in any environment', () => {
            for (const environment of [ 'development', 'production' ]) {
                for (const workingTree of [ 'true', 1, 0, null, {}, [] ]) {
                    const error = catchError(() => readWorkingTreeSwitch(makeConfig(environment, { workingTree })));

                    assert(error, 'expected an error to be thrown');
                    assertEqual('OperationalError', error.name);
                    assertMatches('CONTENT_STORE.workingTree', error.message);
                    assertMatches(`"${ environment }"`, error.message);
                }
            }
        });
    });

    describe('the core plugin\'s register()', ({ it }) => {
        function makeContext(config) {
            const services = [];
            return {
                services,
                context: {
                    config,
                    registerService(name) {
                        services.push(name);
                    },
                },
            };
        }

        it('registers the store when the switch is acceptable', () => {
            for (const config of [ makeConfig('development'), makeConfig('production'), undefined ]) {
                const { context, services } = makeContext(config);

                register(context);

                assertEqual('ContentAddressableStore', services.join(','));
            }
        });

        it('fails boot, registering nothing, when the key is true outside development', () => {
            const { context, services } = makeContext(makeConfig('production', { workingTree: true }));

            const error = catchError(() => register(context));

            assert(error, 'expected an error to be thrown');
            assertEqual('OperationalError', error.name);
            assertMatches('CONTENT_STORE.workingTree', error.message);
            assertEqual(0, services.length);
        });
    });
});
