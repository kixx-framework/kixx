import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import runDevServer from '../../../lib/devserver/run-dev-server.js';
import UsageError from '../../../lib/usage-error.js';
import captureOutput from '../../helpers/capture-output.js';


describe('runDevServer()', ({ before, after, it }) => {
    let directory;

    before(async () => {
        directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-run-dev-server-')));
        await fsp.writeFile(path.join(directory, 'node-server.js'), '');
    });

    after(async () => {
        await fsp.rm(directory, { recursive: true, force: true });
    });

    it('prefixes log lines with the label and resolves 0 after SIGINT', async () => {
        const subject = makeSubject();

        const pending = runDevServer(subject.args({
            projectDirectory: directory,
            port: 5000,
            environment: 'local',
            dotenv: '/instances/alpha/.env',
        }));

        await waitForListener(subject.signals);

        assertEqual(5000, subject.created[0].port);
        assertEqual('local', subject.created[0].environment);
        assertEqual('/instances/alpha/.env', subject.created[0].dotenv);
        assertEqual(directory, subject.created[0].projectDirectory);
        assertMatches('[kixx local] listening on http://localhost:4321', subject.output.chunks.join(''));

        subject.signals.emit('SIGINT');

        assertEqual(0, await pending);
        assertEqual(1, subject.devServer.stopCount);
        assertMatches('[kixx local] stopping', subject.output.chunks.join(''));
        assertEqual(0, subject.signals.listenerCount('SIGINT'));
        assertEqual(0, subject.signals.listenerCount('SIGTERM'));
    });

    it('throws a UsageError with the given hint when node-server.js is missing', async () => {
        const subject = makeSubject();
        const missing = path.join(directory, 'missing-app');

        let error = null;

        try {
            await runDevServer(subject.args({ projectDirectory: missing, port: 0, environment: 'local' }));
        } catch (cause) {
            error = cause;
        }

        assert(error instanceof UsageError, 'expected a UsageError');
        assertEqual(
            `No app server found at ${ path.join(missing, 'node-server.js') }. Use the source app.`,
            error.message,
        );
        assertEqual(0, subject.created.length);
    });
});


function makeSubject() {
    const output = captureOutput();
    const signals = new EventEmitter();
    const created = [];

    const devServer = {
        port: 4321,
        stopCount: 0,
        async start() {},
        async stop() {
            this.stopCount += 1;
        },
    };

    const args = (overrides) => ({
        label: 'kixx local',
        missingServerHint: 'Use the source app.',
        output,
        signals,
        createDevServer: (options) => {
            created.push(options);
            return devServer;
        },
        ...overrides,
    });

    return { output, signals, created, devServer, args };
}

async function waitForListener(signals) {
    for (let i = 0; i < 100 && signals.listenerCount('SIGINT') === 0; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
            setTimeout(resolve, 1);
        });
    }
}
