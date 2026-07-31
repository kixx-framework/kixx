import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import AppRuntime from '../../../../src/kixx/context/app-runtime.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('AppRuntime', ({ describe }) => {

    describe('command runtime', ({ it }) => {
        it('exposes the command as an enumerable property', () => {
            const runtime = new AppRuntime({ command: 'publish' });

            assertEqual('publish', runtime.command);
            assert(Object.keys(runtime).includes('command'), 'expected command to be enumerable');
            assertUndefined(runtime.server);
        });
    });

    describe('server runtime', ({ it }) => {
        it('exposes the server as an enumerable property', () => {
            const server = { name: 'test-server' };

            const runtime = new AppRuntime({ server });

            assertEqual(server, runtime.server);
            assert(Object.keys(runtime).includes('server'), 'expected server to be enumerable');
            assertUndefined(runtime.command);
        });
    });

    describe('build', ({ it }) => {
        it('exposes build metadata when provided', () => {
            const build = { id: 'build-123' };

            const runtime = new AppRuntime({
                server: { name: 'test-server' },
                build,
            });

            assertEqual(build, runtime.build);
            assert(Object.keys(runtime).includes('build'), 'expected build to be enumerable');
        });

        it('leaves build undefined when omitted', () => {
            const runtime = new AppRuntime({ command: 'publish' });

            assertUndefined(runtime.build);
        });

        it('allows missing and null Build IDs', () => {
            const missing = new AppRuntime({ server: {}, build: {} });
            const nullId = new AppRuntime({ server: {}, build: { id: null } });

            assertEqual(undefined, missing.build.id);
            assertEqual(null, nullId.build.id);
        });
    });

    describe('immutability', ({ it }) => {
        it('deeply freezes the runtime descriptor', () => {
            const runtime = new AppRuntime({
                server: {
                    name: 'test-server',
                    transports: [
                        { type: 'http' },
                    ],
                },
                build: {
                    id: 'build-123',
                    metadata: {
                        revision: 42,
                    },
                },
            });

            assert(Object.isFrozen(runtime));
            assert(Object.isFrozen(runtime.server));
            assert(Object.isFrozen(runtime.server.transports));
            assert(Object.isFrozen(runtime.server.transports[0]));
            assert(Object.isFrozen(runtime.build));
            assert(Object.isFrozen(runtime.build.metadata));
        });
    });

    describe('validation', ({ it }) => {
        it('throws an AssertionError when neither runtime mode is provided', () => {
            const caught = catchError(() => new AppRuntime());

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('exactly one', caught.message);
        });

        it('throws an AssertionError when both runtime modes are provided', () => {
            const caught = catchError(() => new AppRuntime({
                command: 'publish',
                server: {},
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('exactly one', caught.message);
        });

        it('throws an AssertionError when command is empty', () => {
            const caught = catchError(() => new AppRuntime({ command: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('command', caught.message);
        });

        it('throws an AssertionError when server is null', () => {
            const caught = catchError(() => new AppRuntime({ server: null }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('server', caught.message);
        });

        it('throws an AssertionError when server is a primitive', () => {
            const caught = catchError(() => new AppRuntime({ server: 'http' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('server', caught.message);
        });

        it('throws an AssertionError for malformed or reserved Build IDs', () => {
            for (const buildId of [ '', 'build/child', 'dev' ]) {
                const caught = catchError(() => new AppRuntime({
                    server: {},
                    build: { id: buildId },
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('build id', caught.message);
            }
        });
    });
});
