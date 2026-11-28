import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import runCli from '../../lib/run-cli.js';
import UsageError from '../../lib/usage-error.js';
import createPlaceholderCommand from '../../lib/placeholder-command.js';
import loadProjectTooling from '../../lib/project/load-project-tooling.js';
import captureOutput from '../helpers/capture-output.js';
import { withTemporaryDirectory, writeProjectMarker } from '../helpers/temporary-project.js';


// Nothing exists here: no project above it, and no settings in it.
const EMPTY_DIRECTORY = path.join(os.tmpdir(), 'kixx-dev-run-cli-no-such-directory');

const PROJECT = { requiresProject: true };


// A command class that records how it was constructed and called. Its run()
// calls the given function with the constructor arguments.
function makeCommand(run, statics) {
    const calls = [];

    class FakeCommand {
        static description = 'A fake command';

        constructor(args) {
            this.args = args;
        }

        async run(options, positionals) {
            calls.push({ args: this.args, options, positionals });
            return await run?.(this.args);
        }
    }

    Object.assign(FakeCommand, statics);
    FakeCommand.calls = calls;

    return FakeCommand;
}

async function run(argv, commands, options) {
    const stdout = captureOutput();
    const stderr = captureOutput();

    const code = await runCli({
        argv,
        cwd: EMPTY_DIRECTORY,
        homeDirectory: EMPTY_DIRECTORY,
        stdout,
        stderr,
        commands,
        groups: { tools: 'Tools for things' },
        version: '1.2.3',
        loadProjectTooling: failToLoadTooling,
        ...options,
    });

    return { code, stdout: stdout.chunks.join(''), stderr: stderr.chunks.join('') };
}

// Fails unless stdout is exactly one line of JSON, then returns it parsed.
function parseEnvelope(stdout) {
    assertMatches(/^[^\n]+\n$/, stdout, 'stdout is one line');
    return JSON.parse(stdout);
}

// Error text is wrapped at 80 columns, and where it breaks depends on the
// length of the temporary directory's path on the machine.
function unwrap(text) {
    return text.replace(/\s+/g, ' ');
}

// The default loader of these tests: a test that expects tooling passes its
// own, and every other test proves the loader was never called.
function failToLoadTooling() {
    throw new Error('the tooling loader was called');
}

// Runs a command line inside a temporary project. `home` is an empty
// directory beside it unless the function writes to it.
async function withProject(fn, options) {
    return await withTemporaryDirectory(async (directory) => {
        const project = await writeProjectMarker(path.join(directory, 'project'), options);
        const home = path.join(directory, 'home');

        await fsp.mkdir(home);

        const runInProject = (argv, commands, runOptions) => {
            return run(argv, commands, { cwd: project, homeDirectory: home, version: '7.0.0', ...runOptions });
        };

        return await fn({ project, home, run: runInProject });
    });
}


describe('runCli()', ({ describe }) => {

    describe('dispatch', ({ it }) => {
        it('runs a one-word command', async () => {
            const Build = makeCommand();
            const { code } = await run([ 'build' ], { build: Build });

            assertEqual(0, code);
            assertEqual(1, Build.calls.length);
        });

        it('runs a two-word command', async () => {
            const Sharpen = makeCommand();
            const { code } = await run([ 'tools', 'sharpen' ], { 'tools sharpen': Sharpen });

            assertEqual(0, code);
            assertEqual(1, Sharpen.calls.length);
        });

        it('tries the first two words before the first word', async () => {
            const One = makeCommand();
            const Two = makeCommand();

            // A real registry never holds both; this shows the order alone.
            await run([ 'tools', 'sharpen' ], { 'tools': One, 'tools sharpen': Two });

            assertEqual(0, One.calls.length);
            assertEqual(1, Two.calls.length);
        });

        it('passes the tokens after the command words to the command', async () => {
            const Build = makeCommand(null, {
                options: { target: { type: 'string', short: 't' } },
                positionals: [ { name: 'name', description: 'Name' } ],
            });

            await run([ 'build', 'alpha', '--target', 'out' ], { build: Build });

            assertEqual('out', Build.calls[0].options.target);
            assertEqual('alpha', Build.calls[0].positionals.name);
        });

        it('takes the command words from before the first flag only', async () => {
            const Sharpen = makeCommand();
            const One = makeCommand(null, { ...PROJECT, options: { fast: { type: 'boolean' } } });

            // "sharpen" comes after a flag, so it is an argument of "tools".
            const { code, stderr } = await run(
                [ 'tools', '--fast', 'sharpen', 'extra' ],
                { 'tools': One, 'tools sharpen': Sharpen },
            );

            assertEqual(2, code);
            assertMatches('Unexpected argument "extra"', stderr);
            assertEqual(0, Sharpen.calls.length);
        });

        it('does not resolve inherited object properties as commands', async () => {
            const { code, stderr } = await run([ 'constructor' ], { build: makeCommand() });

            assertEqual(2, code);
            assertMatches('The command "constructor" does not exist', stderr);
        });
    });

    describe('what a command is given', ({ it }) => {
        it('writes to stdout without --json', async () => {
            const Build = makeCommand((args) => {
                args.output.write('built\n');
                args.stdout.write('child out\n');
                args.stderr.write('child err\n');
            });

            const { code, stdout, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(0, code);
            assertEqual('built\nchild out\n', stdout);
            assertEqual('child err\n', stderr);
        });

        it('never prints data without --json', async () => {
            const Build = makeCommand(() => ({ files: [ 'a.js' ] }));
            const { code, stdout, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(0, code);
            assertEqual('', stdout);
            assertEqual('', stderr);
        });

        it('sends the command\'s human text to stderr with --json', async () => {
            const Build = makeCommand((args) => {
                args.output.write('built\n');
                args.stdout.write('child out\n');
                args.stderr.write('child err\n');
                return { files: [ 'a.js' ] };
            });

            const { code, stdout, stderr } = await run([ 'build', '--json' ], { build: Build });

            assertEqual(0, code);
            assertEqual('built\nchild out\nchild err\n', stderr);

            const envelope = parseEnvelope(stdout);
            assertEqual(true, envelope.ok);
            assertEqual('build', envelope.command);
            assertEqual('a.js', envelope.data.files[0]);
        });

        it('passes no Cloudflare config', async () => {
            const Build = makeCommand();
            await run([ 'build' ], { build: Build });

            assert(!Object.hasOwn(Build.calls[0].args, 'cloudflareConfig'), 'no cloudflareConfig key');
        });
    });

    describe('a command that runs anywhere', ({ it }) => {
        it('is given its streams and nothing else', async () => {
            const Build = makeCommand();
            const { code } = await run([ 'build' ], { build: Build });

            assertEqual(0, code);
            assertEqual('output,stdout,stderr', Object.keys(Build.calls[0].args).join(','));
        });

        it('runs outside a project', async () => {
            await withTemporaryDirectory(async (directory) => {
                const Build = makeCommand();
                const { code } = await run([ 'build' ], { build: Build }, { cwd: directory, homeDirectory: directory });

                assertEqual(0, code);
                assertEqual(1, Build.calls.length);
            });
        });

        it('takes no directory argument', async () => {
            const Build = makeCommand();
            const { code, stderr } = await run([ 'build', '.' ], { build: Build });

            assertEqual(2, code);
            assertMatches('Unexpected argument ".". This command takes no positional arguments.', stderr);
            assertEqual(0, Build.calls.length);
        });

        it('reads no project manifest and no settings, and loads no tooling', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                // All three would fail if the runner touched them.
                await writeProjectMarker(project, { manifestText: '{ broken' });
                await fsp.mkdir(path.join(project, '.kixx'));
                await fsp.writeFile(path.join(project, '.kixx', 'config.json'), '{ broken');

                const commands = { build: makeCommand(), sync: makeCommand(null, { requiresTooling: true }) };

                const ran = await runInProject([ 'build' ], commands);
                const help = await runInProject([ 'sync', '--help' ], commands);
                const version = await runInProject([ 'sync', '--version' ], commands);
                const topLevel = await runInProject([ '--help' ], commands);

                assertEqual(0, ran.code);
                assertEqual('', ran.stderr);
                assertEqual(0, help.code);
                assertMatches(/^Usage: kixx-dev sync \[options\] \[directory\]\n/, help.stdout);
                assertEqual(0, version.code);
                assertEqual(0, topLevel.code);
                assertEqual(0, commands.sync.calls.length);
            });
        });
    });

    describe('a command that requires a project', ({ it }) => {
        it('is given the project directory, both settings, and its streams', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                const Build = makeCommand(null, PROJECT);
                const { code, stderr } = await runInProject([ 'build' ], { build: Build });

                assertEqual(0, code);
                assertEqual('', stderr);
                assertEqual('projectDirectory,config,secrets,output,stdout,stderr', Object.keys(Build.calls[0].args).join(','));
                assertEqual(project, Build.calls[0].args.projectDirectory);
                assertEqual(0, Object.keys(Build.calls[0].args.config).length);
                assertEqual(0, Object.keys(Build.calls[0].args.secrets).length);
            });
        });

        it('finds the project root from a subdirectory of it', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                const deep = path.join(project, 'app', 'pages');

                await fsp.mkdir(deep, { recursive: true });

                const Build = makeCommand(null, PROJECT);
                const { code } = await runInProject([ 'build' ], { build: Build }, { cwd: deep });

                assertEqual(0, code);
                assertEqual(project, Build.calls[0].args.projectDirectory);
            });
        });

        it('starts the search at the directory argument, resolved against the working directory', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                await fsp.mkdir(path.join(project, 'app'));

                const Build = makeCommand(null, PROJECT);
                const cwd = path.dirname(project);

                const root = await runInProject([ 'build', 'project' ], { build: Build }, { cwd });
                const inside = await runInProject([ 'build', 'project/app' ], { build: Build }, { cwd });
                const absolute = await runInProject([ 'build', project ], { build: Build }, { cwd: EMPTY_DIRECTORY });

                assertEqual('0,0,0', [ root.code, inside.code, absolute.code ].join(','));

                for (const call of Build.calls) {
                    assertEqual(project, call.args.projectDirectory);
                }
            });
        });

        it('exits 3 as ProjectNotFound outside a project, naming the start directory', async () => {
            await withTemporaryDirectory(async (directory) => {
                const Build = makeCommand(null, PROJECT);
                const options = { cwd: directory, homeDirectory: directory };

                const text = await run([ 'build' ], { build: Build }, options);
                const json = await run([ 'build', '--json' ], { build: Build }, options);
                const envelope = parseEnvelope(json.stdout);

                assertEqual(3, text.code);
                assertEqual('', text.stdout);
                assertMatches(directory, text.stderr);
                assertMatches('is not inside a Kixx project', unwrap(text.stderr));
                assert(!/\n\s+at /.test(text.stderr), 'printed a stack');

                assertEqual(3, json.code);
                assertEqual(false, envelope.ok);
                assertEqual('build', envelope.command);
                assertEqual('ProjectNotFound', envelope.error.code);
                assertEqual(3, envelope.error.exitCode);
                assertEqual('', json.stderr);
                assertEqual(0, Build.calls.length);
            });
        });

        it('does not take a .kixx directory for a project', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, '.kixx'));
                await fsp.writeFile(path.join(directory, '.kixx', 'config.json'), '{"color":"red"}');

                const { code } = await run(
                    [ 'build' ],
                    { build: makeCommand(null, PROJECT) },
                    { cwd: directory, homeDirectory: EMPTY_DIRECTORY },
                );

                assertEqual(3, code);
            });
        });

        it('merges the home settings under the project settings', async () => {
            await withProject(async ({ project, home, run: runInProject }) => {
                await fsp.mkdir(path.join(home, '.kixx'));
                await fsp.mkdir(path.join(project, '.kixx'));
                await fsp.writeFile(path.join(home, '.kixx', 'config.json'), '{"color":"red","size":1}');
                await fsp.writeFile(path.join(project, '.kixx', 'config.json'), '{"color":"blue"}');
                await fsp.writeFile(path.join(home, '.kixx', 'secrets.json'), '{"token":"home-token"}');

                const Build = makeCommand(null, PROJECT);
                const { code } = await runInProject([ 'build' ], { build: Build });

                assertEqual(0, code);
                assertEqual('blue', Build.calls[0].args.config.color);
                assertEqual(1, Build.calls[0].args.config.size);
                assertEqual('home-token', Build.calls[0].args.secrets.token);
            });
        });

        it('loads the settings once for a project at the home directory', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                await fsp.mkdir(path.join(project, '.kixx'));
                await fsp.writeFile(path.join(project, '.kixx', 'config.json'), '{"color":"red"}');

                const Build = makeCommand(null, { ...PROJECT, requiredConfig: [ 'size' ] });
                const { code, stderr } = await runInProject([ 'build' ], { build: Build }, { homeDirectory: project });

                // The missing key lists the one file, once.
                assertEqual(2, code);
                assertEqual(1, stderr.split(path.join(project, '.kixx', 'config.json')).length - 1);
            });
        });
    });

    describe('the project version gate', ({ it }) => {
        it('runs a project at the oldest supported version, with or without a prerelease tag', async () => {
            for (const version of [ '7.0.0-alpha.0', '7.0.0' ]) {
                // eslint-disable-next-line no-await-in-loop
                await withProject(async ({ run: runInProject }) => {
                    const Build = makeCommand(null, PROJECT);
                    const { code, stderr } = await runInProject([ 'build' ], { build: Build }, { version: '7.0.0-alpha.0' });

                    assertEqual(0, code, version);
                    assertEqual('', stderr, version);
                    assertEqual(1, Build.calls.length, version);
                }, { version });
            }
        });

        it('exits 3 for another major version, naming both versions and the action', async () => {
            const cases = [
                [ '6.9.0', 'Install kixx-dev version 6' ],
                [ '8.0.0', 'Upgrade kixx-dev to version 8' ],
            ];

            for (const [ version, action ] of cases) {
                // eslint-disable-next-line no-await-in-loop
                await withProject(async ({ run: runInProject }) => {
                    const Build = makeCommand(null, PROJECT);
                    const options = { version: '7.0.0-alpha.0' };

                    const text = await runInProject([ 'build' ], { build: Build }, options);
                    const json = await runInProject([ 'build', '--json' ], { build: Build }, options);
                    const envelope = parseEnvelope(json.stdout);

                    assertEqual(3, text.code, version);
                    assertEqual('', text.stdout);
                    assert(!/\n\s+at /.test(text.stderr), 'printed a stack');

                    assertEqual(3, json.code, version);
                    assertEqual('UnsupportedProjectVersion', envelope.error.code);
                    assertEqual(3, envelope.error.exitCode);
                    assertMatches(`Kixx ${ version }`, envelope.error.message);
                    assertMatches('kixx-dev 7.0.0-alpha.0', envelope.error.message);
                    assertMatches(action, envelope.error.message);
                    assertEqual(0, Build.calls.length);
                }, { version });
            }
        });

        it('exits 3 for a manifest that is not JSON or has no version', async () => {
            for (const manifestText of [ '{ broken', '{"name":"kixx"}', '{"version":"seven"}' ]) {
                // eslint-disable-next-line no-await-in-loop
                await withProject(async ({ project, run: runInProject }) => {
                    const Build = makeCommand(null, PROJECT);
                    const { code, stdout } = await runInProject([ 'build', '--json' ], { build: Build });
                    const envelope = parseEnvelope(stdout);

                    assertEqual(3, code, manifestText);
                    assertEqual('UnsupportedProjectVersion', envelope.error.code);
                    assertMatches(path.join(project, 'kixx', 'plugin.json'), envelope.error.message);
                    assertEqual(0, Build.calls.length);
                }, { manifestText });
            }
        });

        it('runs a same-major project newer than the CLI, with one line on stderr', async () => {
            await withProject(async ({ run: runInProject }) => {
                const Build = makeCommand(() => ({ built: true }), PROJECT);

                const text = await runInProject([ 'build' ], { build: Build }, { version: '7.1.0' });
                const json = await runInProject([ 'build', '--json' ], { build: Build }, { version: '7.1.0' });

                const line = 'The project uses Kixx 7.2.0, which is newer than kixx-dev 7.1.0. '
                    + 'Upgrade kixx-dev if something fails.\n';

                assertEqual(0, text.code);
                assertEqual('', text.stdout);
                assertEqual(line, text.stderr);

                assertEqual(0, json.code);
                assertEqual(line, json.stderr);
                assertEqual('{"ok":true,"command":"build","data":{"built":true}}\n', json.stdout);
                assertEqual(2, Build.calls.length);
            }, { version: '7.2.0' });
        });

        it('runs before the settings are read', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                await fsp.mkdir(path.join(project, '.kixx'));
                await fsp.writeFile(path.join(project, '.kixx', 'config.json'), '{ broken');

                const { code, stderr } = await runInProject([ 'build' ], { build: makeCommand(null, PROJECT) });

                assertEqual(3, code);
                assertMatches('Kixx 6.0.0', stderr);
            }, { version: '6.0.0' });
        });

        it('runs for a command that needs tooling, before the tooling is loaded', async () => {
            await withProject(async ({ run: runInProject }) => {
                const Sync = makeCommand(null, { requiresTooling: true });
                const { code } = await runInProject([ 'sync' ], { sync: Sync });

                // The default loader of these tests throws, which would exit 1.
                assertEqual(3, code);
            }, { version: '8.0.0' });
        });
    });

    describe('a command that requires tooling', ({ it }) => {
        it('is given what the loader resolves for the project directory', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                const tooling = Object.freeze({ tooling: {} });
                const loaded = [];

                const Sync = makeCommand(null, { requiresTooling: true });

                const { code } = await runInProject([ 'sync' ], { sync: Sync }, {
                    loadProjectTooling: async (projectDirectory) => {
                        loaded.push(projectDirectory);
                        return tooling;
                    },
                });

                assertEqual(0, code);
                assertEqual(project, loaded.join(','));
                assertEqual(tooling, Sync.calls[0].args.tooling);
                assertEqual(project, Sync.calls[0].args.projectDirectory);
                assertEqual(
                    'projectDirectory,config,secrets,tooling,output,stdout,stderr',
                    Object.keys(Sync.calls[0].args).join(','),
                );
            });
        });

        it('takes the directory argument', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                const Sync = makeCommand(null, { requiresTooling: true });

                const { code } = await runInProject([ 'sync', project ], { sync: Sync }, {
                    cwd: EMPTY_DIRECTORY,
                    loadProjectTooling: async () => ({}),
                });

                assertEqual(0, code);
                assertEqual(project, Sync.calls[0].args.projectDirectory);
            });
        });

        it('loads no tooling for a command that only requires the project', async () => {
            await withProject(async ({ run: runInProject }) => {
                const Build = makeCommand(null, PROJECT);
                const { code } = await runInProject([ 'build' ], { build: Build });

                assertEqual(0, code);
                assert(!Object.hasOwn(Build.calls[0].args, 'tooling'), 'no tooling key');
            });
        });

        it('exits 3, naming the file, when the project has no tooling module', async () => {
            await withProject(async ({ run: runInProject }) => {
                const Sync = makeCommand(null, { requiresTooling: true });

                // The real loader, against a project that holds only its manifest.
                const { code, stdout } = await runInProject([ 'sync', '--json' ], { sync: Sync }, { loadProjectTooling });
                const envelope = parseEnvelope(stdout);

                assertEqual(3, code);
                assertEqual('UnsupportedProjectVersion', envelope.error.code);
                assertMatches('kixx/tooling/mod.js', envelope.error.message);
                assertEqual(0, Sync.calls.length);
            });
        });

        it('exits 1 when the tooling fails to load for another reason', async () => {
            await withProject(async ({ run: runInProject }) => {
                const { code, stderr } = await runInProject([ 'sync' ], { sync: makeCommand(null, { requiresTooling: true }) });

                assertEqual(1, code);
                assertMatches('the tooling loader was called', stderr);
            });
        });
    });

    describe('the --json envelope', ({ it }) => {
        it('wraps returned data', async () => {
            const { code, stdout } = await run([ 'build', '--json' ], { build: makeCommand(() => ({ port: 2026 })) });
            const envelope = parseEnvelope(stdout);

            assertEqual(0, code);
            assertEqual('{"ok":true,"command":"build","data":{"port":2026}}\n', stdout);
            assertEqual(2026, envelope.data.port);
        });

        it('uses an empty object when the command resolves undefined', async () => {
            const { stdout } = await run([ 'build', '--json' ], { build: makeCommand() });

            assertEqual('{"ok":true,"command":"build","data":{}}\n', stdout);
        });

        // A command never picks an exit code: an integer is not data.
        it('exits 1 when a command resolves 0', async () => {
            const { code, stdout, stderr } = await run([ 'build', '--json' ], { build: makeCommand(() => 0) });
            const envelope = parseEnvelope(stdout);

            assertEqual(1, code);
            assertEqual(false, envelope.ok);
            assertEqual('UnexpectedError', envelope.error.code);
            assertMatches('resolves a plain object or undefined', stderr);
        });

        it('accepts --json before the command words', async () => {
            const { code, stdout } = await run([ '--json', 'tools', 'sharpen' ], { 'tools sharpen': makeCommand() });

            assertEqual(0, code);
            assertEqual('tools sharpen', parseEnvelope(stdout).command);
        });

        it('reports --version', async () => {
            const { code, stdout, stderr } = await run([ '--version', '--json' ], { build: makeCommand() });

            assertEqual(0, code);
            assertEqual('{"ok":true,"command":null,"data":{"version":"1.2.3"}}\n', stdout);
            assertEqual('', stderr);
        });

        it('reports a UsageError', async () => {
            const Build = makeCommand(() => {
                throw new UsageError('Pick a color.');
            });

            const { code, stdout, stderr } = await run([ 'build', '--json' ], { build: Build });
            const envelope = parseEnvelope(stdout);

            assertEqual(2, code);
            assertEqual(false, envelope.ok);
            assertEqual('build', envelope.command);
            assertEqual('UsageError', envelope.error.code);
            assertEqual(2, envelope.error.exitCode);
            assertEqual('Pick a color.', envelope.error.message);
            assertEqual('', stderr);
        });

        it('reports an unexpected error, with its stack on stderr', async () => {
            const Build = makeCommand(() => {
                throw new Error('It broke.');
            });

            const { code, stdout, stderr } = await run([ 'build', '--json' ], { build: Build });
            const envelope = parseEnvelope(stdout);

            assertEqual(1, code);
            assertEqual(false, envelope.ok);
            assertEqual('UnexpectedError', envelope.error.code);
            assertEqual(1, envelope.error.exitCode);
            assertEqual('It broke.', envelope.error.message);
            assertMatches('Error: It broke.', stderr);
            assertMatches(/\n\s+at /, stderr);
        });

        it('reports an unknown command with a null command', async () => {
            const { code, stdout, stderr } = await run([ 'nope', '--json' ], { build: makeCommand() });
            const envelope = parseEnvelope(stdout);

            assertEqual(2, code);
            assertEqual(null, envelope.command);
            assertEqual('UsageError', envelope.error.code);
            assertMatches('The command "nope" does not exist', envelope.error.message);
            assertEqual('', stderr);
        });

        it('reports a project ValidationError with its problems', async () => {
            const Build = makeCommand(() => {
                // Shaped like core's class, which the devkit never imports.
                const error = new Error('The manifest is invalid.');
                error.name = 'ValidationError';
                error.errors = [ { message: 'name is required', source: 'plugins/a/plugin.json' } ];
                throw error;
            });

            const { code, stdout, stderr } = await run([ 'build', '--json' ], { build: Build });
            const envelope = parseEnvelope(stdout);

            assertEqual(2, code);
            assertEqual('ValidationError', envelope.error.code);
            assertEqual(2, envelope.error.exitCode);
            assertEqual(1, envelope.error.problems.length);
            assertEqual('name is required', envelope.error.problems[0].message);
            assertEqual('plugins/a/plugin.json', envelope.error.problems[0].source);
            assertEqual('', stderr);
        });

        it('reports data that cannot be serialized as a defect', async () => {
            const { code, stdout } = await run([ 'build', '--json' ], { build: makeCommand(() => ({ size: 1n })) });

            assertEqual(1, code);
            assertEqual('UnexpectedError', parseEnvelope(stdout).error.code);
        });
    });

    describe('exit codes and errors without --json', ({ it }) => {
        it('prints a UsageError message alone on stderr and exits 2', async () => {
            const Build = makeCommand(() => {
                throw new UsageError('Pick a color.');
            });

            const { code, stdout, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(2, code);
            assertEqual('', stdout);
            assertEqual('Pick a color.\n', stderr);
        });

        it('prints a thrown Error with its stack and cause on stderr and exits 1', async () => {
            const Build = makeCommand(() => {
                throw new Error('It broke.', { cause: new Error('The root cause.') });
            });

            const { code, stdout, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(1, code);
            assertEqual('', stdout);
            assertMatches(/^Failed to run command:\n/, stderr);
            assertMatches('Error: It broke.', stderr);
            assertMatches(/\n\s+at /, stderr);
            assertMatches('The root cause.', stderr);
        });

        it('exits 2 for a UsageError subclass and keeps its code', async () => {
            class OutOfPaintError extends UsageError {}

            const Build = makeCommand(() => {
                throw new OutOfPaintError('Buy paint.');
            });

            const text = await run([ 'build' ], { build: Build });
            const json = await run([ 'build', '--json' ], { build: Build });

            assertEqual(2, text.code);
            assertEqual('Buy paint.\n', text.stderr);
            assertEqual('OutOfPaintError', parseEnvelope(json.stdout).error.code);
        });

        it('exits 2 with the message alone for a project OperationalError', async () => {
            const Build = makeCommand(() => {
                const error = new Error('kixx/plugin.json is missing.');
                error.name = 'OperationalError';
                throw error;
            });

            const { code, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(2, code);
            assertEqual('kixx/plugin.json is missing.\n', stderr);
        });

        it('exits 2 for an unknown command and lists what exists on stderr', async () => {
            const { code, stdout, stderr } = await run([ 'nope' ], { build: makeCommand() });

            assertEqual(2, code);
            assertEqual('', stdout);
            assertMatches(/^The command "nope" does not exist\./, stderr);
            assertMatches(/^ {2}build {2}A fake command$/m, stderr);
        });

        it('exits 2 when no command is given', async () => {
            const { code, stdout, stderr } = await run([], { build: makeCommand() });

            assertEqual(2, code);
            assertEqual('', stdout);
            assertMatches(/^A command name is required\./, stderr);
            assertMatches(/^ {2}build {2}A fake command$/m, stderr);
        });

        it('exits 2 for a group with no command and lists the group', async () => {
            const commands = { 'build': makeCommand(), 'tools sharpen': makeCommand() };
            const { code, stderr } = await run([ 'tools' ], commands);

            assertEqual(2, code);
            assertMatches(/^"tools" needs a command name after it\./, stderr);
            assertMatches(/^ {2}tools sharpen {2}/m, stderr);
            assert(!/^ {2}build {2}/m.test(stderr), 'lists only the group');
        });

        it('exits 2 for an unknown command of a group', async () => {
            const { code, stderr } = await run([ 'tools', 'nope' ], { 'tools sharpen': makeCommand() });

            assertEqual(2, code);
            assertMatches(/^The command "tools nope" does not exist\./, stderr);
            assertMatches(/^ {2}tools sharpen {2}/m, stderr);
        });

        it('exits 2 for an unknown flag and names the help command', async () => {
            const Sharpen = makeCommand();
            const { code, stderr } = await run([ 'tools', 'sharpen', '--nope' ], { 'tools sharpen': Sharpen });

            assertEqual(2, code);
            assertMatches('--nope', stderr);
            assertMatches('Run "kixx-dev tools sharpen --help" for usage.', stderr);
            assertEqual(0, Sharpen.calls.length);
            assert(!stderr.includes('Failed to run command'), 'printed as a crash');
        });

        it('exits 2 for a missing positional', async () => {
            const Build = makeCommand(null, { positionals: [ { name: 'name', description: 'Name' } ] });
            const { code, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(2, code);
            assertMatches('Missing required argument <name>. Run "kixx-dev build --help" for usage.', stderr);
            assertEqual(0, Build.calls.length);
        });

        it('exits 2 for a directory argument that does not exist', async () => {
            const { code, stderr } = await run([ 'build', 'no-such-directory' ], { build: makeCommand(null, PROJECT) });

            assertEqual(2, code);
            assertMatches(path.join(EMPTY_DIRECTORY, 'no-such-directory'), stderr);
            assertMatches('does not exist', unwrap(stderr));
        });

        it('exits 2 for a missing required setting, naming the key and the files', async () => {
            await withProject(async ({ project, home, run: runInProject }) => {
                const Build = makeCommand(null, {
                    ...PROJECT,
                    requiredConfig: [ 'paint.color' ],
                    requiredSecrets: [ 'paint.token' ],
                });

                const { code, stderr } = await runInProject([ 'build' ], { build: Build });

                assertEqual(2, code);
                assertMatches('Missing required configuration settings for "build":', stderr);
                assertMatches('  paint.color', stderr);
                assertMatches(path.join(home, '.kixx', 'config.json'), stderr);
                assertMatches(path.join(project, '.kixx', 'config.json'), stderr);
                assertEqual(0, Build.calls.length);
            });
        });

        it('exits 2 for malformed settings', async () => {
            await withProject(async ({ project, run: runInProject }) => {
                await fsp.mkdir(path.join(project, '.kixx'));
                await fsp.writeFile(path.join(project, '.kixx', 'config.json'), '{ broken');

                const { code, stderr } = await runInProject([ 'build' ], { build: makeCommand(null, PROJECT) });

                assertEqual(2, code);
                assertMatches('Unable to parse JSON', stderr);
            });
        });

        it('exits 1 when a command resolves something other than data', async () => {
            for (const value of [ 1, 'done', [ 'a' ], null ]) {
                // eslint-disable-next-line no-await-in-loop
                const { code, stderr } = await run([ 'build' ], { build: makeCommand(() => value) });

                assertEqual(1, code, `resolved ${ JSON.stringify(value) }`);
                assertMatches('a command resolves a plain object or undefined', stderr);
            }
        });

        it('exits 1 for a thrown value that is not an Error', async () => {
            const Build = makeCommand(() => {
                // eslint-disable-next-line no-throw-literal
                throw 'a bare string';
            });

            const { code, stderr } = await run([ 'build' ], { build: Build });

            assertEqual(1, code);
            assertMatches('a bare string', stderr);
        });
    });

    describe('--version', ({ it }) => {
        it('prints the version and exits 0', async () => {
            const { code, stdout } = await run([ '--version' ], { build: makeCommand() });

            assertEqual(0, code);
            assertEqual('1.2.3\n', stdout);
        });

        it('wins after a command name, and the command does not run', async () => {
            const Build = makeCommand();
            const { code, stdout } = await run([ 'build', '-v' ], { build: Build });

            assertEqual(0, code);
            assertEqual('1.2.3\n', stdout);
            assertEqual(0, Build.calls.length);
        });

        it('defaults to the deno.json version', async () => {
            const { stdout } = await run([ '--version' ], { build: makeCommand() }, { version: undefined });

            assertMatches(/^\d+\.\d+\.\d+/, stdout);
        });
    });

    describe('--help', ({ it }) => {
        const commands = {
            'build': makeCommand(null, {
                ...PROJECT,
                description: 'Build the thing',
                options: { target: { type: 'string', short: 't', description: 'Where to build' } },
                positionals: [ { name: 'name', description: 'Name of the thing' } ],
                requiredConfig: [ 'paint.color' ],
            }),
            'tools sharpen': makeCommand(null, { description: 'Sharpen a tool' }),
            'tools polish': createPlaceholderCommand('Polish a tool'),
        };

        it('lists every command at the top level on stdout', async () => {
            const { code, stdout, stderr } = await run([ '--help' ], commands);

            assertEqual(0, code);
            assertEqual('', stderr);
            assertMatches(/^Usage: kixx-dev <command> \[options\] \[\.\.\.args\]\n/, stdout);
            assertMatches(/^ {2}build {10}Build the thing$/m, stdout);
            assertMatches(/^ {2}tools sharpen {2}Sharpen a tool$/m, stdout);
            assertMatches(/\n\nNot available in this version:\n {2}tools polish {3}Polish a tool\n\nOptions:\n/, stdout);
        });

        it('returns the top level as data', async () => {
            const { code, stdout } = await run([ '--help', '--json' ], commands);
            const { ok, command, data } = parseEnvelope(stdout);

            assertEqual(0, code);
            assertEqual(true, ok);
            assertEqual(null, command);
            assertEqual('1.2.3', data.version);
            assertEqual('build,tools sharpen,tools polish', data.commands.map(({ name }) => name).join(','));
            assertEqual('true,true,false', data.commands.map(({ available }) => available).join(','));
            assertEqual('Build the thing', data.commands[0].description);
            assertEqual('0,1,2,3,3,4', data.exitCodes.map(({ code: exitCode }) => exitCode).join(','));
            assertEqual('CommandNotAvailable', data.exitCodes.at(-1).name);
            assert(data.exitCodes.every(({ meaning }) => meaning.length > 0), 'every code has a meaning');
        });

        it('lists a group\'s commands', async () => {
            const { code, stdout } = await run([ 'tools', '--help' ], commands);

            assertEqual(0, code);
            assertMatches(/^Usage: kixx-dev tools <command> \[options\] \[\.\.\.args\]\n\n {2}Tools for things\n/, stdout);
            assertMatches(/^ {2}tools sharpen {2}/m, stdout);
            assert(!/^ {2}build {2}/m.test(stdout), 'lists only the group');
        });

        it('returns a group as data', async () => {
            const { code, stdout } = await run([ 'tools', '--help', '--json' ], commands);
            const { ok, command, data } = parseEnvelope(stdout);

            assertEqual(0, code);
            assertEqual(true, ok);
            assertEqual(null, command);
            assertEqual('tools', data.group);
            assertEqual('Tools for things', data.description);
            assertEqual('tools sharpen,tools polish', data.commands.map(({ name }) => name).join(','));
        });

        it('prints a command\'s help without running it', async () => {
            const { code, stdout } = await run([ 'build', '-h' ], commands);

            assertEqual(0, code);
            assertMatches(/^Usage: kixx-dev build \[options\] <name> \[directory\]\n/, stdout);
            assertEqual(0, commands.build.calls.length);
        });

        it('returns every documented field for a command', async () => {
            const { code, stdout } = await run([ 'build', '--help', '--json' ], commands);
            const { ok, command, data } = parseEnvelope(stdout);

            assertEqual(0, code);
            assertEqual(true, ok);
            assertEqual('build', command);
            assertEqual(
                'name,available,description,usage,positionals,options,requiredConfig,requiredSecrets,requiresProject',
                Object.keys(data).join(','),
            );
            assertEqual('build', data.name);
            assertEqual(true, data.available);
            assertEqual('kixx-dev build [options] <name> [directory]', data.usage);
            assertEqual('paint.color', data.requiredConfig.join(','));
        });

        it('fails for help on an unknown command, on stderr', async () => {
            const { code, stdout, stderr } = await run([ 'nope', '--help' ], commands);

            assertEqual(2, code);
            assertEqual('', stdout);
            assertMatches('The command "nope" does not exist', stderr);
        });

        it('works in a directory with malformed settings', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, '.kixx'));
                await fsp.writeFile(path.join(directory, '.kixx', 'config.json'), '{ broken');

                const options = { cwd: directory, homeDirectory: directory };
                const help = await run([ 'build', '--help' ], commands, options);
                const unknown = await run([ 'tools', 'nope' ], commands, options);

                assertEqual(0, help.code);
                assertEqual(2, unknown.code);
                assertMatches('The command "tools nope" does not exist', unknown.stderr);
            });
        });
    });

    describe('a placeholder command', ({ it }) => {
        const commands = { deploy: createPlaceholderCommand('Deploy the app') };

        it('exits 4 and says it is not available', async () => {
            const { code, stdout, stderr } = await run([ 'deploy' ], commands);

            assertEqual(4, code);
            assertEqual('', stdout);
            assertEqual('The "deploy" command is not available in this version of kixx-dev.\n', stderr);
        });

        it('exits 4 whatever the arguments', async () => {
            const { code } = await run([ 'deploy', '-e', 'production', '--force', 'a', 'b', 'c' ], commands);

            assertEqual(4, code);
        });

        it('needs no settings', async () => {
            await withTemporaryDirectory(async (directory) => {
                await fsp.mkdir(path.join(directory, '.kixx'));
                await fsp.writeFile(path.join(directory, '.kixx', 'config.json'), '{ broken');

                const { code } = await run([ 'deploy' ], commands, { cwd: directory, homeDirectory: directory });

                assertEqual(4, code);
            });
        });

        it('reports CommandNotAvailable in the envelope', async () => {
            const { code, stdout } = await run([ 'deploy', '--json', '--force' ], commands);
            const envelope = parseEnvelope(stdout);

            assertEqual(4, code);
            assertEqual(false, envelope.ok);
            assertEqual('deploy', envelope.command);
            assertEqual('CommandNotAvailable', envelope.error.code);
            assertEqual(4, envelope.error.exitCode);
        });

        it('prints help that says it is not available and exits 0', async () => {
            const { code, stdout } = await run([ 'deploy', '--help' ], commands);

            assertEqual(0, code);
            assertMatches(/^Usage: kixx-dev deploy\n\n {2}Deploy the app\n\n {2}Not available in this version of kixx-dev\.\n/, stdout);
        });

        it('returns available false in its help data', async () => {
            const { code, stdout } = await run([ 'deploy', '--help', '--json' ], commands);
            const { data } = parseEnvelope(stdout);

            assertEqual(0, code);
            assertEqual(false, data.available);
            assertEqual('Deploy the app', data.description);
            assertEqual(0, data.positionals.length);
        });
    });
});
