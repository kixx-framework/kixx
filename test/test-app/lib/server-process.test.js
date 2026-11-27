import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import {
    getRuntimeCommand,
    isAnswering,
    startServerProcess,
} from '../../../test-app/lib/server-process.js';
import { createFakeClock, createFakeFetch, createFakeSpawn } from './process-fakes.js';


const PROJECT_DIRECTORY = path.join(path.sep, 'made-up', 'project');
const NODE = { command: '/usr/bin/node', args: [] };
const DENO = { command: '/usr/bin/deno', args: [ 'run', '-A' ] };


describe('test-app/lib/server-process.js', ({ describe }) => {

    describe('getRuntimeCommand()', ({ it }) => {
        it('runs a script with the Node.js executable alone', () => {
            const runtime = getRuntimeCommand({ execPath: '/usr/bin/node', versions: { node: '24.0.0' } });

            assertEqual('/usr/bin/node', runtime.command);
            assertEqual('[]', JSON.stringify(runtime.args));
        });

        it('runs a script under Deno with every permission', () => {
            const runtime = getRuntimeCommand({ execPath: '/usr/bin/deno', versions: { node: '24.0.0', deno: '2.8.0' } });

            assertEqual('/usr/bin/deno', runtime.command);
            assertEqual('["run","-A"]', JSON.stringify(runtime.args));
        });

        it('refuses a process with no executable path', () => {
            const caught = catchError(() => getRuntimeCommand({}));

            assertEqual('AssertionError', caught.name);
        });
    });

    describe('isAnswering()', ({ it }) => {
        it('counts any response, without following a redirect', async () => {
            const fakeFetch = createFakeFetch(() => ({ status: 503 }));

            const answered = await isAnswering({ fetch: fakeFetch, url: 'http://localhost:1/', clock: createFakeClock() });

            assertEqual(true, answered);
            assertEqual('http://localhost:1/', fakeFetch.calls[0].url);
            assertEqual('manual', fakeFetch.calls[0].init.redirect);
        });

        it('lets go of the response body', async () => {
            let cancelled = 0;

            const fakeFetch = createFakeFetch(() => {
                return {
                    status: 200,
                    body: {
                        async cancel() {
                            cancelled += 1;
                        },
                    },
                };
            });

            await isAnswering({ fetch: fakeFetch, url: 'http://localhost:1/', clock: createFakeClock() });

            assertEqual(1, cancelled);
        });

        it('is false for a refused connection', async () => {
            const fakeFetch = createFakeFetch(() => undefined);

            assertEqual(false, await isAnswering({ fetch: fakeFetch, url: 'http://localhost:1/', clock: createFakeClock() }));
        });

        it('gives up on a request that is never answered', async () => {
            const clock = createFakeClock();
            const started = clock.now();

            const answered = await isAnswering({
                fetch: hangingFetch,
                url: 'http://localhost:1/',
                clock,
                timeoutMs: 700,
            });

            assertEqual(false, answered);
            assertEqual(700, clock.now() - started);
        });
    });

    describe('startServerProcess()', ({ it }) => {
        it('starts the entry point in the project directory with the environment and port', () => {
            const { spawn } = start({ environment: 'production', port: 2026 });

            assertEqual(1, spawn.calls.length);

            const [ { command, args, options } ] = spawn.calls;

            assertEqual('/usr/bin/node', command);
            assertEqual(
                JSON.stringify([
                    path.join(PROJECT_DIRECTORY, 'node-server.js'),
                    '--environment',
                    'production',
                    '--port',
                    '2026',
                ]),
                JSON.stringify(args),
            );
            assertEqual(PROJECT_DIRECTORY, options.cwd);
            assertEqual('["ignore","pipe","pipe"]', JSON.stringify(options.stdio));
        });

        it('puts the Deno arguments before the entry point', () => {
            const { spawn } = start({ runtime: DENO });

            const [ { command, args } ] = spawn.calls;

            assertEqual('/usr/bin/deno', command);
            assertEqual(
                JSON.stringify([ 'run', '-A', path.join(PROJECT_DIRECTORY, 'node-server.js') ]),
                JSON.stringify(args.slice(0, 3)),
            );
        });

        it('starts another entry point when one is named', () => {
            const { spawn } = start({ entryPoint: 'other-server.js' });

            assertEqual(path.join(PROJECT_DIRECTORY, 'other-server.js'), spawn.calls[0].args[0]);
        });

        it('gives the child exactly the environment it was given', () => {
            const env = { PATH: '/bin', BUILD_ID: 'b1' };
            const { spawn } = start({ env });

            assertEqual(JSON.stringify(env), JSON.stringify(spawn.calls[0].options.env));
        });

        it('answers on localhost at the port', () => {
            const { server } = start({ port: 4123 });

            assertEqual('http://localhost:4123/', server.url);
        });

        it('refuses a missing option', () => {
            for (const name of [ 'spawn', 'fetch', 'runtime', 'projectDirectory', 'environment', 'port', 'env' ]) {
                const caught = catchError(() => start({ [name]: undefined }));

                assert(caught, `expected an error for a missing ${ name }`);
                assertEqual('AssertionError', caught.name);
            }
        });
    });

    describe('waitUntilReady()', ({ it }) => {
        it('polls until the server answers', async () => {
            let refusals = 3;

            const fakeFetch = createFakeFetch(() => {
                if (refusals > 0) {
                    refusals -= 1;
                    return undefined;
                }

                return { status: 503 };
            });

            const clock = createFakeClock();
            const started = clock.now();
            const { server, child } = start({ fetch: fakeFetch, clock });

            await server.waitUntilReady({ intervalMs: 100 });

            assertEqual(4, fakeFetch.calls.length);
            assertEqual('http://localhost:2026/', fakeFetch.calls[0].url);
            assertEqual(300, clock.now() - started);
            assertEqual(0, child.signals.length);
        });

        it('rejects when the process exits first, with its exit code', async () => {
            const fakeFetch = createFakeFetch(() => undefined);
            const clock = createFakeClock();
            const { server, child } = start({ fetch: fakeFetch, clock });

            clock.setTimeout(() => child.exit(1), 250);

            const caught = await catchAsyncError(() => server.waitUntilReady());

            assertEqual('ServerExitedEarly', caught.code);
            assertMatches('exit code 1', caught.message);
            // Nothing is left to kill.
            assertEqual(0, child.signals.length);
        });

        it('wakes from its wait when the process exits', async () => {
            const clock = createFakeClock();
            const started = clock.now();
            const { server, child } = start({ fetch: createFakeFetch(() => undefined), clock });

            clock.setTimeout(() => child.exit(1), 250);

            await catchAsyncError(() => server.waitUntilReady({ intervalMs: 10000 }));

            assertEqual(250, clock.now() - started);
        });

        it('rejects when the process has already exited', async () => {
            const fakeFetch = createFakeFetch(() => ({ status: 200 }));
            const { server, child } = start({ fetch: fakeFetch });

            child.exit(3);

            const caught = await catchAsyncError(() => server.waitUntilReady());

            assertEqual('ServerExitedEarly', caught.code);
            assertEqual(0, fakeFetch.calls.length);
        });

        it('does not take an answer from something else on the port for its own', async () => {
            // The process fails to bind the port while another server answers.
            const { spawn, server } = start({
                fetch: createFakeFetch(() => {
                    spawn.calls[0].child.exit(1);
                    return { status: 200 };
                }),
            });

            const caught = await catchAsyncError(() => server.waitUntilReady());

            assertEqual('ServerExitedEarly', caught.code);
        });

        it('kills the process and rejects when the wait ends', async () => {
            const fakeFetch = createFakeFetch(() => undefined);
            const clock = createFakeClock();
            const started = clock.now();
            const { server, child } = start({ fetch: fakeFetch, clock });

            child.onKill = () => child.exit(null, 'SIGKILL');

            const caught = await catchAsyncError(() => server.waitUntilReady({ timeoutMs: 1000, intervalMs: 100 }));

            assertEqual('ServerNotReady', caught.code);
            assertMatches('http://localhost:2026/', caught.message);
            assertMatches('1000 ms', caught.message);
            assertEqual(1000, clock.now() - started);
            assertEqual('["SIGKILL"]', JSON.stringify(child.signals));

            const exit = await server.exited;

            assertEqual('SIGKILL', exit.signal);
        });

        it('counts a request that is never answered as not ready', async () => {
            const clock = createFakeClock();
            const { server, child } = start({ fetch: hangingFetch, clock });

            child.onKill = () => child.exit(null, 'SIGKILL');

            const caught = await catchAsyncError(() => server.waitUntilReady({ timeoutMs: 3000 }));

            assertEqual('ServerNotReady', caught.code);
            assertEqual('["SIGKILL"]', JSON.stringify(child.signals));
        });

        it('rejects when the process could not be started', async () => {
            const { server, child } = start({ fetch: createFakeFetch(() => undefined) });

            child.emit('error', new Error('spawn ENOENT'));

            const caught = await catchAsyncError(() => server.waitUntilReady());

            assertEqual('ServerExitedEarly', caught.code);
            assertMatches('spawn ENOENT', caught.message);
            assertEqual(0, child.signals.length);
        });
    });

    describe('output and exit', ({ it }) => {
        it('resolves the exit code and everything the process wrote', async () => {
            const { server, child } = start();

            child.write('stdout', 'one\n');
            child.write('stderr', 'two\n');
            child.write('stdout', 'three\n');

            assertEqual('one\ntwo\nthree\n', server.output());

            child.exit(7);

            const exit = await server.exited;

            assertEqual(7, exit.code);
            assertEqual(null, exit.signal);
            assertEqual(null, exit.error);
            assertEqual('one\ntwo\nthree\n', exit.output);
            assertEqual('one\nthree\n', exit.stdout);
            assertEqual('two\n', exit.stderr);
        });

        it('reads both streams as text', () => {
            const { child } = start();

            assertEqual('utf8', child.stdout.encoding);
            assertEqual('utf8', child.stderr.encoding);
        });

        it('hands each chunk to onOutput as it arrives', () => {
            const seen = [];
            const { child } = start({ onOutput: (text) => seen.push(text) });

            child.write('stdout', 'a');
            child.write('stderr', 'b');

            assertEqual('["a","b"]', JSON.stringify(seen));
        });

        it('resolves the signal that ended the process', async () => {
            const { server, child } = start();

            child.exit(null, 'SIGINT');

            const exit = await server.exited;

            assertEqual(null, exit.code);
            assertEqual('SIGINT', exit.signal);
        });

        it('resolves the error of a process that could not be started', async () => {
            const { server, child } = start();
            const error = new Error('spawn ENOENT');

            child.emit('error', error);

            const exit = await server.exited;

            assertEqual(null, exit.code);
            assertEqual(error, exit.error);
        });
    });

    describe('signal()', ({ it }) => {
        it('sends the signal to the process', () => {
            const { server, child } = start();

            assertEqual(true, server.signal('SIGINT'));
            assertEqual('["SIGINT"]', JSON.stringify(child.signals));
        });

        it('sends nothing once the process has exited', () => {
            const { server, child } = start();

            child.exit(0);

            assertEqual(false, server.signal('SIGTERM'));
            assertEqual(0, child.signals.length);
        });
    });

    describe('stop()', ({ it }) => {
        it('sends SIGTERM and resolves the exit', async () => {
            const clock = createFakeClock();
            const { server, child } = start({ clock });

            child.onKill = () => {
                child.write('stdout', 'draining\n');
                clock.setTimeout(() => child.exit(0), 40);
            };

            const stopped = await server.stop();

            assertEqual('["SIGTERM"]', JSON.stringify(child.signals));
            assertEqual(0, stopped.code);
            assertEqual(false, stopped.forced);
            assertEqual('draining\n', stopped.output);
        });

        it('sends another signal when one is named', async () => {
            const { server, child } = start();

            child.onKill = () => child.exit(0);

            await server.stop({ signal: 'SIGINT' });

            assertEqual('["SIGINT"]', JSON.stringify(child.signals));
        });

        it('kills a process that does not exit in time', async () => {
            const clock = createFakeClock();
            const started = clock.now();
            const { server, child } = start({ clock });

            child.onKill = (signal) => {
                if (signal === 'SIGKILL') {
                    child.exit(null, 'SIGKILL');
                }
            };

            const stopped = await server.stop({ timeoutMs: 5000 });

            assertEqual('["SIGTERM","SIGKILL"]', JSON.stringify(child.signals));
            assertEqual(true, stopped.forced);
            assertEqual('SIGKILL', stopped.signal);
            assertEqual(5000, clock.now() - started);
        });

        it('sends nothing to a process that has already exited', async () => {
            const { server, child } = start();

            child.exit(2);

            const stopped = await server.stop();

            assertEqual(0, child.signals.length);
            assertEqual(2, stopped.code);
            assertEqual(false, stopped.forced);
        });

        it('sends one signal however often it is called', async () => {
            const clock = createFakeClock();
            const { server, child } = start({ clock });

            child.onKill = () => clock.setTimeout(() => child.exit(0), 10);

            const [ first, second ] = await Promise.all([ server.stop(), server.stop() ]);

            assertEqual('["SIGTERM"]', JSON.stringify(child.signals));
            assertEqual(0, first.code);
            assertEqual(0, second.code);
        });

        it('stops a process whose start was never confirmed', async () => {
            // A caller's `finally` runs after any failure, this one included.
            const clock = createFakeClock();
            const { server, child } = start({ fetch: createFakeFetch(() => undefined), clock });

            child.onKill = () => child.exit(null, 'SIGKILL');

            await catchAsyncError(() => server.waitUntilReady({ timeoutMs: 200 }));

            const stopped = await server.stop();

            assertEqual('["SIGKILL"]', JSON.stringify(child.signals));
            assertEqual('SIGKILL', stopped.signal);
            assertFalsy(stopped.forced);
        });
    });
// The fake clock gives each timer a turn of the event loop, and CI is slow.
}, { timeout: 5000 });


// Starts a server process over fakes. An option given as undefined is left
// out, to test a missing one.
function start(overrides = {}) {
    const options = {
        spawn: createFakeSpawn(),
        fetch: createFakeFetch(() => ({ status: 200 })),
        clock: createFakeClock(),
        runtime: NODE,
        projectDirectory: PROJECT_DIRECTORY,
        environment: 'production',
        port: 2026,
        env: {},
        ...overrides,
    };

    const server = startServerProcess(options);

    return { server, spawn: options.spawn, child: options.spawn.calls[0].child };
}

// A server that accepts the connection and says nothing, until the request
// is aborted.
function hangingFetch(_url, init) {
    return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
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

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
