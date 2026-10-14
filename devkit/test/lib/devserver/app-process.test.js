import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { AppProcess, canConnect, getFreePort } from '../../../lib/devserver/app-process.js';
import captureOutput from '../../helpers/capture-output.js';


const STOP_TIMEOUT_MS = 11000;


// A stand-in for a ChildProcess. By default it exits as soon as it is
// signalled; `isIgnoringSigterm` makes it exit only on SIGKILL, and
// `isExitingOnKill: false` leaves exiting to the test.
function makeFakeChild(options) {
    const {
        isIgnoringSigterm = false,
        isExitingOnKill = true,
    } = options ?? {};

    const child = new EventEmitter();

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kills = [];

    child.exit = (code, signal) => {
        child.exitCode = code;
        child.signalCode = signal;
        child.emit('exit', code, signal);
    };

    child.kill = (signal) => {
        child.kills.push(signal);

        if (signal === 'SIGKILL' || (isExitingOnKill && !isIgnoringSigterm)) {
            child.exit(null, signal);
        }

        return true;
    };

    return child;
}

function makeSubject(options) {
    const {
        makeChild = () => makeFakeChild(),
        canConnect: probe = async () => true,
        delay = async () => {},
        ...rest
    } = options ?? {};

    const spawned = [];
    const logs = [];
    const stdout = captureOutput();
    const stderr = captureOutput();

    const subject = new AppProcess({
        projectDirectory: '/project',
        environment: 'development',
        stdout,
        stderr,
        log: (message) => logs.push(message),
        spawn: (command, args, spawnOptions) => {
            const child = makeChild(spawned.length);
            spawned.push({ command, args, options: spawnOptions, child });
            return child;
        },
        getFreePort: async () => 4001 + spawned.length,
        canConnect: probe,
        delay,
        execPath: '/runtime/bin',
        isDeno: false,
        ...rest,
    });

    return { subject, spawned, logs, stdout, stderr };
}

// Lets stream 'data' events and timer-scheduled fake events run.
function nextMacrotask() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

// A delay() whose stop timeout only ends when the stop aborts it, so a fake
// child decides when it exits without triggering SIGKILL.
function delayWithoutStopTimeout(ms, signal) {
    if (ms !== STOP_TIMEOUT_MS) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
    });
}

function countCrashLogs(logs) {
    return logs.filter((line) => line.startsWith('app server exited')).length;
}


describe('AppProcess', ({ describe }) => {

    describe('child command', ({ it }) => {
        it('spawns node-server.js with Node arguments', async () => {
            const { subject, spawned } = makeSubject();

            await subject.ensureReady();

            const { command, args, options } = spawned[0];

            assertEqual('/runtime/bin', command);
            assertEqual(
                JSON.stringify([ '/project/node-server.js', '--environment', 'development', '--port', '4001' ]),
                JSON.stringify(args),
            );
            assertEqual('/project', options.cwd);
            assertEqual(JSON.stringify([ 'ignore', 'pipe', 'pipe' ]), JSON.stringify(options.stdio));
            assertEqual(undefined, options.detached);
        });

        it('forwards --dotenv when given', async () => {
            const { subject, spawned } = makeSubject({ environment: 'local', dotenv: '/home/me/x.env' });

            await subject.ensureReady();

            assertEqual(
                JSON.stringify([
                    '/project/node-server.js', '--environment', 'local', '--dotenv', '/home/me/x.env', '--port', '4001',
                ]),
                JSON.stringify(spawned[0].args),
            );
        });

        it('prefixes Deno arguments with run -A', async () => {
            const withoutDotenv = makeSubject({ isDeno: true });
            const withDotenv = makeSubject({ isDeno: true, dotenv: '/x.env' });

            await withoutDotenv.subject.ensureReady();
            await withDotenv.subject.ensureReady();

            assertEqual(
                JSON.stringify([ 'run', '-A', '/project/node-server.js', '--environment', 'development', '--port', '4001' ]),
                JSON.stringify(withoutDotenv.spawned[0].args),
            );
            assertEqual(
                JSON.stringify([
                    'run', '-A', '/project/node-server.js', '--environment', 'development', '--dotenv', '/x.env', '--port', '4001',
                ]),
                JSON.stringify(withDotenv.spawned[0].args),
            );
            assertEqual('/project', withDotenv.spawned[0].options.cwd);
        });
    });

    describe('captured output', ({ it }) => {
        it('keeps the last 64 KiB, forwards everything, and resets at each spawn', async () => {
            const { subject, spawned, stdout, stderr } = makeSubject();

            await subject.ensureReady();

            const child = spawned[0].child;
            const head = 'a'.repeat(10 * 1024);
            const tail = 'b'.repeat(60 * 1024);

            child.stdout.write(head);
            child.stderr.write(tail);
            await nextMacrotask();

            assertEqual(64 * 1024, subject.output.length);
            assert(subject.output.endsWith(tail));
            assertEqual(head, stdout.chunks.join(''));
            assertEqual(tail, stderr.chunks.join(''));

            subject.markChanged();
            await subject.ensureReady();

            assertEqual('', subject.output);
        });
    });

    describe('getFreePort() and canConnect()', ({ it }) => {
        it('detects listening and closed ports', async () => {
            const port = await getFreePort();
            const server = net.createServer();

            assert(port > 0);

            await new Promise((resolve) => {
                server.listen(port, '127.0.0.1', resolve);
            });

            try {
                assertEqual(true, await canConnect(port));
            } finally {
                await new Promise((resolve) => {
                    server.close(resolve);
                });
            }

            assertEqual(false, await canConnect(port));
        });
    });

    describe('ensureReady()', ({ it }) => {
        it('spawns once and reuses the child until a change', async () => {
            let probeCount = 0;

            const { subject, spawned, logs } = makeSubject({
                canConnect: async () => {
                    probeCount += 1;
                    return probeCount >= 3;
                },
            });

            const first = await subject.ensureReady();
            const second = await subject.ensureReady();

            assertEqual(4001, first.port);
            assertEqual(4001, second.port);
            assertEqual(1, spawned.length);
            assertEqual(3, probeCount);
            assert(logs.includes('starting app server'));
            assert(logs.includes('app server ready on port 4001'));
        });

        it('shares one restart among concurrent callers and spawns after the old child exits', async () => {
            const { subject, spawned } = makeSubject({
                makeChild: () => makeFakeChild({ isExitingOnKill: false }),
                delay: delayWithoutStopTimeout,
            });

            await subject.ensureReady();
            const oldChild = spawned[0].child;

            subject.markChanged();

            const pending = [];
            for (let i = 0; i < 10; i += 1) {
                pending.push(subject.ensureReady());
            }

            await nextMacrotask();

            assertEqual(1, spawned.length, 'no spawn before the old child exits');
            assertEqual(JSON.stringify([ 'SIGTERM' ]), JSON.stringify(oldChild.kills));

            oldChild.exit(null, 'SIGTERM');

            const results = await Promise.all(pending);

            assertEqual(2, spawned.length);
            assertEqual(JSON.stringify([ 'SIGTERM' ]), JSON.stringify(oldChild.kills));
            assert(results.every((result) => result.port === 4002));
        });

        it('records an exit before readiness and does not retry until a change', async () => {
            const { subject, spawned } = makeSubject({
                makeChild: (index) => {
                    const child = makeFakeChild();

                    if (index === 0) {
                        setTimeout(() => {
                            child.stderr.write('SyntaxError: Unexpected token\n');
                            setTimeout(() => child.exit(1, null), 5);
                        }, 0);
                    }

                    return child;
                },
                canConnect: async (port) => {
                    await nextMacrotask();
                    return port !== 4001;
                },
            });

            const first = await subject.ensureReady();

            assertMatches('exited before accepting connections (code 1, signal null)', first.failure.reason);
            assertMatches('SyntaxError: Unexpected token', first.failure.output);

            const second = await subject.ensureReady();

            assertEqual(first.failure, second.failure);
            assertEqual(1, spawned.length);

            subject.markChanged();
            const third = await subject.ensureReady();

            assertEqual(2, spawned.length);
            assertEqual(4002, third.port);
        });

        it('stops a child that never accepts connections', async () => {
            let probeCount = 0;

            const { subject, spawned } = makeSubject({
                canConnect: async () => {
                    probeCount += 1;
                    return false;
                },
            });

            const result = await subject.ensureReady();

            assertEqual('app server did not accept connections on port 4001 within 10 s', result.failure.reason);
            assertEqual(200, probeCount);
            assertEqual(JSON.stringify([ 'SIGTERM' ]), JSON.stringify(spawned[0].child.kills));
        });

        it('records a spawn error without an uncaught error event', async () => {
            const { subject } = makeSubject({
                makeChild: () => {
                    const child = makeFakeChild();

                    Promise.resolve().then(() => child.emit('error', new Error('spawn /runtime/bin ENOENT')));

                    return child;
                },
                canConnect: async () => {
                    await nextMacrotask();
                    return false;
                },
            });

            const result = await subject.ensureReady();

            assertMatches('spawn /runtime/bin ENOENT', result.failure.reason);
        });

        it('sends SIGKILL to a child that ignores SIGTERM and still restarts', async () => {
            const { subject, spawned, logs } = makeSubject({
                makeChild: () => makeFakeChild({ isIgnoringSigterm: true }),
            });

            await subject.ensureReady();
            subject.markChanged();

            const result = await subject.ensureReady();

            assertEqual(JSON.stringify([ 'SIGTERM', 'SIGKILL' ]), JSON.stringify(spawned[0].child.kills));
            assertEqual(4002, result.port);
            assert(logs.includes('app server did not exit within 11 s; sending SIGKILL'));
        });

        it('logs a crash once and restarts on the next request without a change', async () => {
            const { subject, spawned, logs } = makeSubject();

            await subject.ensureReady();
            spawned[0].child.exit(1, null);

            assertEqual(1, countCrashLogs(logs));
            assert(logs.includes('app server exited (code 1, signal null); it will restart on the next request'));

            const result = await subject.ensureReady();

            assertEqual(2, spawned.length);
            assertEqual(4002, result.port);
            assertEqual(1, countCrashLogs(logs));
        });

        it('never logs a restart or shutdown stop as a crash', async () => {
            const { subject, logs } = makeSubject();

            await subject.ensureReady();
            subject.markChanged();
            await subject.ensureReady();
            await subject.stop();

            assertEqual(0, countCrashLogs(logs));
            assertEqual(2, logs.filter((line) => line === 'stopping app server').length);
        });

        it('restarts once more after a change during an in-flight restart', async () => {
            let releaseProbe;

            const { subject, spawned } = makeSubject({
                canConnect: (port) => {
                    if (port !== 4001) {
                        return Promise.resolve(true);
                    }

                    return new Promise((resolve) => {
                        releaseProbe = resolve;
                    });
                },
            });

            const pending = subject.ensureReady();
            await nextMacrotask();

            subject.markChanged();
            releaseProbe(true);

            assertEqual(4001, (await pending).port);

            const next = await subject.ensureReady();
            const after = await subject.ensureReady();

            assertEqual(4002, next.port);
            assertEqual(4002, after.port);
            assertEqual(2, spawned.length);
        });
    });

    describe('stop()', ({ it }) => {
        it('kills a child that is still starting and refuses later requests', async () => {
            let releaseProbe;

            const { subject, spawned } = makeSubject({
                canConnect: () => new Promise((resolve) => {
                    releaseProbe = resolve;
                }),
            });

            const pending = subject.ensureReady();
            await nextMacrotask();

            const stopping = subject.stop();
            releaseProbe(true);

            await stopping;

            const result = await pending;

            assertEqual('the devserver is shutting down', result.failure.reason);
            assertEqual(JSON.stringify([ 'SIGTERM' ]), JSON.stringify(spawned[0].child.kills));
            assertEqual('the devserver is shutting down', (await subject.ensureReady()).failure.reason);

            await subject.stop();

            assertEqual(1, spawned.length);
            assertEqual(1, spawned[0].child.kills.length);
        });
    });
});
