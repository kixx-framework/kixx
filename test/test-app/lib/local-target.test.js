import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy, assertMatches } from 'kixx-assert';

import { LOCAL_TARGET_PORT, runLocalTarget } from '../../../test-app/lib/local-target.js';
import { isValidBuildId } from '../../../kixx/utils/build-id.js';
import { createFakeClock, createFakeFetch, createFakeSpawn } from './process-fakes.js';


const BUILD_DIRECTORY = path.join(path.sep, 'made-up', 'build');
const DATA_DIRECTORY = path.join(path.sep, 'made-up', 'data');
const RUNNER_FILE = path.join(path.sep, 'made-up', 'run-tests.js');
const LOG_FILE = path.join(DATA_DIRECTORY, 'server.log');

// Made up. Nothing accepts them.
const DEPLOY_KEY = `kxdk_${ 'ab'.repeat(32) }`;
const DEPLOY_KEY_HASH = 'cd'.repeat(32);

const NODE = { command: '/usr/bin/node', args: [] };
const DENO = { command: '/usr/bin/deno', args: [ 'run', '-A' ] };


describe('test-app/lib/local-target.js', ({ describe, it }) => {

    it('targets the port the runner calls local', () => {
        assertEqual(2026, LOCAL_TARGET_PORT);
    });

    describe('a passing run', ({ before, it }) => {
        let run;

        before(async () => {
            run = await runWith({
                env: { PATH: '/bin', INTEGRATION_TESTS_DEPLOY_KEY: 'another-targets-key', INTEGRATION_TESTS_TARGET: 'cloudflare' },
                runnerArguments: [ '--skip', 'test-app/test/probe' ],
            });
        });

        it('exits with the runner\'s code', () => {
            assertEqual(0, run.exitCode);
        });

        it('does each step in order', () => {
            assertEqual(
                JSON.stringify([
                    'assemble',
                    'makeTemporaryDirectory',
                    'generateDeployKey',
                    'spawn server',
                    'server answers',
                    'spawn runner',
                    'runner exits',
                    'SIGTERM',
                    'server exits',
                    'removeDirectory',
                ]),
                JSON.stringify(run.events),
            );
        });

        it('builds the test app in the build directory', () => {
            assertEqual(JSON.stringify([ BUILD_DIRECTORY ]), JSON.stringify(run.assembled));
        });

        it('starts the built entry point in production on port 2026', () => {
            const { command, args, options } = run.serverCall;

            assertEqual('/usr/bin/node', command);
            assertEqual(
                JSON.stringify([
                    path.join(BUILD_DIRECTORY, 'node-server.js'),
                    '--environment',
                    'production',
                    '--port',
                    '2026',
                ]),
                JSON.stringify(args),
            );
            assertEqual(BUILD_DIRECTORY, options.cwd);
        });

        it('gives the server the hash, a build id, the proxy setting, and the data directory', () => {
            const { env } = run.serverCall.options;

            assertEqual(DEPLOY_KEY_HASH, env.DEPLOY_KEY_HASH);
            assertEqual(`integration-${ run.startedAt }`, env.BUILD_ID);
            assert(isValidBuildId(env.BUILD_ID), 'expected a valid Build ID');
            assertEqual('true', env.TRUST_PROXY);
            assertEqual(DATA_DIRECTORY, env.DATA_DIRECTORY);
            assertEqual('/bin', env.PATH);
        });

        it('gives the server no deploy key and no other target\'s settings', () => {
            const names = Object.keys(run.serverCall.options.env);

            assertEqual('[]', JSON.stringify(names.filter((name) => name.startsWith('INTEGRATION_TESTS_'))));
        });

        it('waits for the server at the local URL', () => {
            assertEqual('http://localhost:2026/', run.fetch.calls[0].url);
        });

        it('runs the runner against the local target with its own arguments', () => {
            const { command, args, options } = run.runnerCall;

            assertEqual('/usr/bin/node', command);
            assertEqual(
                JSON.stringify([ RUNNER_FILE, '--local', '--skip', 'test-app/test/probe' ]),
                JSON.stringify(args),
            );
            assertEqual('inherit', options.stdio);
        });

        it('gives the runner the key of this run, and not the hash', () => {
            const { env } = run.runnerCall.options;

            assertEqual(DEPLOY_KEY, env.INTEGRATION_TESTS_DEPLOY_KEY);
            assertEqual(undefined, env.DEPLOY_KEY_HASH);
            assertEqual('/bin', env.PATH);
        });

        it('sends the server SIGTERM alone', () => {
            assertEqual('["SIGTERM"]', JSON.stringify(run.serverCall.child.signals));
        });

        it('writes the server\'s output to a log file in the data directory', () => {
            assertEqual(
                JSON.stringify([ [ LOG_FILE, 'listening\n' ], [ LOG_FILE, 'closing\n' ] ]),
                JSON.stringify(run.appended),
            );
        });

        it('removes the data directory', () => {
            assertEqual(JSON.stringify([ DATA_DIRECTORY ]), JSON.stringify(run.removed));
        });

        it('prints no log', () => {
            assertFalsy(run.printed.some((line) => line.includes('log')));
        });
    });

    describe('under Deno', ({ it }) => {
        it('starts the server and the runner with deno run -A', async () => {
            const run = await runWith({ runtime: DENO });

            assertEqual('/usr/bin/deno', run.serverCall.command);
            assertEqual(
                JSON.stringify([ 'run', '-A', path.join(BUILD_DIRECTORY, 'node-server.js'), '--environment', 'production', '--port', '2026' ]),
                JSON.stringify(run.serverCall.args),
            );

            assertEqual('/usr/bin/deno', run.runnerCall.command);
            assertEqual(
                JSON.stringify([ 'run', '-A', RUNNER_FILE, '--local' ]),
                JSON.stringify(run.runnerCall.args),
            );
            assertEqual(0, run.exitCode);
        });
    });

    describe('the secrets', ({ it }) => {
        it('puts neither the key nor the hash in an argument or a printed line', async () => {
            // Every kind of run prints different lines.
            const runs = await Promise.all([
                runWith(),
                runWith({ runtime: DENO }),
                runWith({ runnerExitCode: 1 }),
                runWith({ serverExitsEarly: true }),
                runWith({ serverNeverAnswers: true }),
                runWith({ serverExitCode: 1 }),
            ]);

            for (const run of runs) {
                const text = JSON.stringify([
                    run.printed,
                    run.spawn.calls.map(({ command, args }) => [ command, args ]),
                    run.assembled,
                ]);

                assertFalsy(text.includes(DEPLOY_KEY));
                assertFalsy(text.includes(DEPLOY_KEY_HASH));
            }
        });

        it('blanks them in the log it prints, should the server ever write one', async () => {
            const run = await runWith({
                runnerExitCode: 1,
                serverStartOutput: `hash ${ DEPLOY_KEY_HASH } key ${ DEPLOY_KEY }\n`,
            });

            const text = run.printed.join('\n');

            assertMatches('hash [redacted] key [redacted]', text);
            assertFalsy(text.includes(DEPLOY_KEY));
            assertFalsy(text.includes(DEPLOY_KEY_HASH));
        });

        it('gives the key to the runner alone and the hash to the server alone', async () => {
            const run = await runWith();

            assertFalsy(JSON.stringify(run.serverCall.options.env).includes(DEPLOY_KEY));
            assertFalsy(JSON.stringify(run.runnerCall.options.env).includes(DEPLOY_KEY_HASH));
        });
    });

    describe('a failing run', ({ it }) => {
        it('exits with the runner\'s code, keeps the data directory, and prints the log', async () => {
            const run = await runWith({ runnerExitCode: 3 });

            assertEqual(3, run.exitCode);
            assertEqual(0, run.removed.length);
            assertEqual('["SIGTERM"]', JSON.stringify(run.serverCall.child.signals));

            const text = run.printed.join('\n');

            assertMatches(`The server's log is kept at ${ LOG_FILE }`, text);
            assertMatches('listening\nclosing', text);
        });

        it('exits with 1 when a signal ended the runner', async () => {
            const run = await runWith({ runnerExitCode: null });

            assertEqual(1, run.exitCode);
            assertEqual('["SIGTERM"]', JSON.stringify(run.serverCall.child.signals));
        });

        it('exits with 1 when the runner could not be started', async () => {
            const run = await runWith({ runnerError: new Error('spawn ENOENT') });

            assertEqual(1, run.exitCode);
            assertMatches('The runner could not be started: spawn ENOENT', run.printed.join('\n'));
            assertEqual('["SIGTERM"]', JSON.stringify(run.serverCall.child.signals));
        });

        it('prints only the end of a long log', async () => {
            const lines = Array.from({ length: 100 }, (_, index) => `line ${ index + 1 }`);
            const run = await runWith({ runnerExitCode: 1, serverStartOutput: `${ lines.join('\n') }\n` });

            const text = run.printed.join('\n');

            assertMatches('Its last 60 lines:', text);
            // The 100 lines and the server's last, `closing`.
            assertFalsy(text.includes('line 41\n'));
            assertMatches('line 42\n', text);
            assertMatches('line 100\nclosing', text);
        });
    });

    describe('a server that does not start', ({ it }) => {
        it('exits with 1 when the server exits before it answers', async () => {
            const run = await runWith({ serverExitsEarly: true });

            assertEqual(1, run.exitCode);
            assertEqual(undefined, run.runnerCall);
            assertEqual(0, run.removed.length);

            const text = run.printed.join('\n');

            assertMatches('The test app did not start: The server exited before it answered (exit code 1)', text);
            assertMatches(`The server's log is kept at ${ LOG_FILE }`, text);
            assertMatches('boot failed', text);
        });

        it('kills the server and exits with 1 when it never answers', async () => {
            const run = await runWith({ serverNeverAnswers: true });

            assertEqual(1, run.exitCode);
            assertEqual(undefined, run.runnerCall);
            assertEqual('["SIGKILL"]', JSON.stringify(run.serverCall.child.signals));
            assertEqual(15000, run.clock.now() - run.startedAt);
            assertMatches('did not answer at http://localhost:2026/ within 15000 ms', run.printed.join('\n'));
            assertMatches(`The server's log is kept at ${ LOG_FILE }`, run.printed.join('\n'));
        });

        it('builds and starts nothing when something already answers on the port', async () => {
            const run = await runWith({ portInUse: true });

            assertEqual(1, run.exitCode);
            assertEqual('[]', JSON.stringify(run.events));
            assertEqual(0, run.spawn.calls.length);
            assertMatches('Something already answers at http://localhost:2026/', run.printed.join('\n'));
        });
    });

    describe('a server that does not stop cleanly', ({ it }) => {
        it('exits with 1 when the server\'s exit code is not 0, though the tests passed', async () => {
            const run = await runWith({ serverExitCode: 1 });

            assertEqual(1, run.exitCode);
            assertEqual(0, run.removed.length);
            assertMatches('did not exit cleanly after SIGTERM (exit code 1)', run.printed.join('\n'));
        });

        it('keeps the runner\'s code when both fail', async () => {
            const run = await runWith({ runnerExitCode: 4, serverExitCode: 1 });

            assertEqual(4, run.exitCode);
        });

        it('kills a server that ignores SIGTERM, and exits with 1', async () => {
            const run = await runWith({ serverIgnoresSigterm: true });

            assertEqual(1, run.exitCode);
            assertEqual('["SIGTERM","SIGKILL"]', JSON.stringify(run.serverCall.child.signals));
            assertMatches('it had to be killed', run.printed.join('\n'));
        });
    });

    describe('a failure of its own', ({ it }) => {
        it('still stops the server when starting the runner throws', async () => {
            const failure = new Error('made-up spawn failure');
            const caught = await catchAsyncError(() => runWith({ runnerSpawnThrows: failure }));

            assertEqual(failure, caught);
            assertEqual('["SIGTERM"]', JSON.stringify(failure.serverCall.child.signals));
        });

        it('starts nothing when the build fails', async () => {
            const failure = new Error('made-up build failure');
            const spawn = createFakeSpawn();

            const caught = await catchAsyncError(() => {
                return runLocalTarget({
                    ...makeOptions(),
                    spawn,
                    assemble: () => Promise.reject(failure),
                });
            });

            assertEqual(failure, caught);
            assertEqual(0, spawn.calls.length);
        });

        it('refuses a missing option', async () => {
            const names = [
                'spawn',
                'fetch',
                'env',
                'runtime',
                'buildDirectory',
                'runnerFile',
                'assemble',
                'generateDeployKey',
                'fileSystem',
                'print',
            ];

            for (const name of names) {
                // eslint-disable-next-line no-await-in-loop
                const caught = await catchAsyncError(() => runLocalTarget({ ...makeOptions(), [name]: undefined }));

                assert(caught, `expected an error for a missing ${ name }`);
                assertEqual('AssertionError', caught.name);
            }
        });
    });
// The fake clock gives each timer a turn of the event loop, and CI is slow.
}, { timeout: 5000 });


// Options over fakes that do nothing.
function makeOptions() {
    return {
        spawn: createFakeSpawn(),
        fetch: createFakeFetch(() => undefined),
        clock: createFakeClock(),
        env: {},
        runtime: NODE,
        buildDirectory: BUILD_DIRECTORY,
        runnerFile: RUNNER_FILE,
        assemble: async () => [],
        generateDeployKey: async () => ({ key: DEPLOY_KEY, hash: DEPLOY_KEY_HASH }),
        fileSystem: {
            makeTemporaryDirectory: async () => DATA_DIRECTORY,
            removeDirectory: async () => {},
            appendFile: () => {},
        },
        print: () => {},
    };
}

// Runs the local target over a scripted server and runner, and resolves
// everything that happened.
async function runWith(scenario = {}) {
    const {
        env = {},
        runtime = NODE,
        runnerArguments,
        runnerExitCode = 0,
        runnerError = null,
        runnerSpawnThrows = null,
        serverExitCode = 0,
        serverExitsEarly = false,
        serverNeverAnswers = false,
        serverIgnoresSigterm = false,
        serverStartOutput = 'listening\n',
        portInUse = false,
    } = scenario;

    const clock = createFakeClock();
    const startedAt = clock.now();
    const events = [];
    const run = {
        clock,
        startedAt,
        events,
        printed: [],
        assembled: [],
        appended: [],
        removed: [],
    };

    let isListening = portInUse;

    function scriptServer(call) {
        const { child } = call;

        run.serverCall = call;
        events.push('spawn server');

        if (serverExitsEarly) {
            clock.setTimeout(() => {
                child.write('stderr', 'boot failed\n');
                child.exit(1);
            }, 150);

            return;
        }

        if (!serverNeverAnswers) {
            // The server takes a while to listen.
            clock.setTimeout(() => {
                child.write('stdout', serverStartOutput);
                isListening = true;
                events.push('server answers');
            }, 250);
        }

        child.onKill = (signal) => {
            events.push(signal);

            if (signal === 'SIGKILL') {
                child.exit(null, 'SIGKILL');
            } else if (!serverIgnoresSigterm) {
                clock.setTimeout(() => {
                    child.write('stdout', 'closing\n');
                    isListening = false;
                    events.push('server exits');
                    child.exit(serverExitCode);
                }, 30);
            }
        };
    }

    function scriptRunner(call) {
        const { child } = call;

        run.runnerCall = call;
        events.push('spawn runner');

        if (runnerSpawnThrows) {
            runnerSpawnThrows.serverCall = run.serverCall;
            throw runnerSpawnThrows;
        }

        clock.setTimeout(() => {
            events.push('runner exits');

            if (runnerError) {
                child.emit('error', runnerError);
            } else {
                child.exit(runnerExitCode, runnerExitCode === null ? 'SIGKILL' : null);
            }
        }, 500);
    }

    run.spawn = createFakeSpawn((call) => {
        if (run.spawn.calls.length === 1) {
            scriptServer(call);
        } else {
            scriptRunner(call);
        }
    });

    run.fetch = createFakeFetch(() => (isListening ? { status: 503 } : undefined));

    run.exitCode = await runLocalTarget({
        spawn: run.spawn,
        fetch: run.fetch,
        clock,
        env,
        runtime,
        runnerArguments,
        buildDirectory: BUILD_DIRECTORY,
        runnerFile: RUNNER_FILE,

        async assemble(directory) {
            events.push('assemble');
            run.assembled.push(directory);
            return [];
        },

        async generateDeployKey() {
            events.push('generateDeployKey');
            return { key: DEPLOY_KEY, hash: DEPLOY_KEY_HASH };
        },

        fileSystem: {
            async makeTemporaryDirectory() {
                events.push('makeTemporaryDirectory');
                return DATA_DIRECTORY;
            },

            async removeDirectory(directory) {
                events.push('removeDirectory');
                run.removed.push(directory);
            },

            appendFile(file, text) {
                run.appended.push([ file, text ]);
            },
        },

        print(line) {
            run.printed.push(line);
        },
    });

    return run;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
