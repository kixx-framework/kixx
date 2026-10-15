import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import DevStartCommand from '../../../commands/dev/start.js';
import UsageError from '../../../lib/usage-error.js';
import captureOutput from '../../helpers/capture-output.js';


function makeFakeDevServer(options) {
    const { startError } = options ?? {};

    return {
        port: 4321,
        startCount: 0,
        stopCount: 0,
        async start() {
            this.startCount += 1;

            if (startError) {
                throw startError;
            }
        },
        async stop() {
            this.stopCount += 1;
        },
    };
}

async function withProject(fn, options) {
    const { hasServer = true } = options ?? {};
    const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dev-start-')));

    try {
        if (hasServer) {
            await fsp.writeFile(path.join(directory, 'node-server.js'), '');
        }

        return await fn(directory);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

function makeCommand(projectDirectory, options) {
    const { devServer = makeFakeDevServer() } = options ?? {};

    const output = captureOutput();
    const signals = new EventEmitter();
    const created = [];

    const command = new DevStartCommand({
        projectDirectory,
        output,
        signals,
        createDevServer: (devServerOptions) => {
            created.push(devServerOptions);
            return devServer;
        },
    });

    return { command, output, signals, created, devServer };
}

// Runs the command until it is listening, then sends SIGINT so run() resolves.
async function runAndInterrupt(subject, options) {
    const pending = subject.command.run(options);

    await waitForListener(subject.signals);
    subject.signals.emit('SIGINT');

    return await pending;
}

async function waitForListener(signals) {
    for (let i = 0; i < 100 && signals.listenerCount('SIGINT') === 0; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
            setTimeout(resolve, 1);
        });
    }
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}


describe('dev start', ({ it }) => {

    it('rejects invalid --port values', async () => {
        await withProject(async (directory) => {
            for (const port of [ 'abc', '70000', '-1', '1.5', '' ]) {
                const { command, created } = makeCommand(directory);

                // eslint-disable-next-line no-await-in-loop
                const error = await catchAsyncError(() => command.run({ port }));

                assert(error instanceof UsageError, `expected a UsageError for "${ port }"`);
                assertMatches('The --port value must be an integer from 0 to 65535', error.message);
                assertEqual(0, created.length);
            }
        });
    });

    it('defaults the port to 2026 and the environment to development', async () => {
        await withProject(async (directory) => {
            const subject = makeCommand(directory);

            const code = await runAndInterrupt(subject, {});

            assertEqual(0, code);
            assertEqual(2026, subject.created[0].port);
            assertEqual('development', subject.created[0].environment);
            assertEqual(undefined, subject.created[0].dotenv);
            assertEqual(directory, subject.created[0].projectDirectory);
        });
    });

    it('accepts --port 0 and forwards -e and an absolute --dotenv path', async () => {
        await withProject(async (directory) => {
            const subject = makeCommand(directory);

            await runAndInterrupt(subject, { port: '0', environment: 'local', dotenv: './x.env' });

            assertEqual(0, subject.created[0].port);
            assertEqual('local', subject.created[0].environment);
            assertEqual(path.resolve('./x.env'), subject.created[0].dotenv);
        });
    });

    it('resolves the project directory to its real path', async () => {
        await withProject(async (directory) => {
            const link = `${ directory }-link`;

            await fsp.symlink(directory, link);

            try {
                const subject = makeCommand(link);

                await runAndInterrupt(subject, {});

                assertEqual(directory, subject.created[0].projectDirectory);
            } finally {
                await fsp.rm(link, { force: true });
            }
        });
    });

    it('requires node-server.js in the project directory', async () => {
        await withProject(async (directory) => {
            const { command, created, signals } = makeCommand(directory);

            const error = await catchAsyncError(() => command.run({}));

            assert(error instanceof UsageError, 'expected a UsageError');
            assertMatches(path.join(directory, 'node-server.js'), error.message);
            assertMatches('inside a Kixx application directory', error.message);
            assertEqual(0, created.length);
            assertEqual(0, signals.listenerCount('SIGINT'));
        }, { hasServer: false });
    });

    it('prints the listening line and stops once on the first signal', async () => {
        await withProject(async (directory) => {
            const subject = makeCommand(directory);
            const pending = subject.command.run({ port: '0' });

            await waitForListener(subject.signals);

            assertEqual(1, subject.devServer.startCount);
            // The line wraps at 80 columns; compare it unwrapped.
            assertMatches(
                `[kixx dev] listening on http://localhost:4321 (environment development, app ${ directory }); ` +
                'press Ctrl-C to stop',
                subject.output.chunks.join('').replace(/\s+/g, ' '),
            );

            subject.signals.emit('SIGINT');
            subject.signals.emit('SIGINT');
            subject.signals.emit('SIGTERM');

            assertEqual(0, await pending);
            assertEqual(1, subject.devServer.stopCount);
            assertEqual(0, subject.signals.listenerCount('SIGINT'));
            assertEqual(0, subject.signals.listenerCount('SIGTERM'));
            assertMatches('[kixx dev] stopping', subject.output.chunks.join(''));
        });
    });

    it('propagates a UsageError from start() without installing signal listeners', async () => {
        await withProject(async (directory) => {
            const startError = new UsageError('Port 2026 is already in use. Choose another port with --port.');
            const subject = makeCommand(directory, { devServer: makeFakeDevServer({ startError }) });

            const error = await catchAsyncError(() => subject.command.run({}));

            assertEqual(startError, error);
            assertEqual(0, subject.signals.listenerCount('SIGINT'));
            assertEqual(0, subject.signals.listenerCount('SIGTERM'));
        });
    });
});
