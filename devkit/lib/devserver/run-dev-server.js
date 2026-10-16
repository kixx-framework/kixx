import path from 'node:path';
import process from 'node:process';
import defaultFileSystem from '../file-system.js';
import { AppProcess } from './app-process.js';
import { DevServer } from './dev-server.js';
import { wrapText } from '../text-wrap.js';
import UsageError from '../usage-error.js';


/**
 * Runs the project's node-server.js behind the devserver until SIGINT or
 * SIGTERM stops it.
 * @param {Object} args
 * @param {string} args.projectDirectory - Application directory holding node-server.js
 * @param {number} args.port - Devserver port
 * @param {string} args.environment - Application environment
 * @param {string} [args.dotenv] - Absolute dotenv path passed to node-server.js
 * @param {string} args.label - Log prefix label, such as "kixx dev"
 * @param {string} args.missingServerHint - Sentence following the missing node-server.js message
 * @param {Object} [args.output] - Stream for devserver log lines
 * @param {Object} [args.stdout] - Stream for app server stdout
 * @param {Object} [args.stderr] - Stream for app server stderr
 * @param {Object} [args.signals] - Signal emitter, defaults to `process`
 * @param {Object} [args.fileSystem] - File system adapter
 * @param {Function} [args.createDevServer] - Devserver factory
 * @returns {Promise<number>} Exit code; 0 after a signal-driven stop
 * @throws {UsageError} When node-server.js is missing
 */
export default async function runDevServer(args) {
    const {
        port,
        environment,
        dotenv,
        label,
        missingServerHint,
        output = process.stdout,
        stdout = process.stdout,
        stderr = process.stderr,
        signals = process,
        fileSystem = defaultFileSystem,
        createDevServer = createDefaultDevServer,
    } = args ?? {};

    const serverScript = path.join(args.projectDirectory, 'node-server.js');

    if (!await fileSystem.isFile(serverScript)) {
        throw new UsageError(`No app server found at ${ serverScript }. ${ missingServerHint }`);
    }

    // Watcher paths are relative to the real path, so resolve symlinks
    // before the watcher starts.
    const projectDirectory = await fileSystem.realpath(args.projectDirectory);

    const log = (message) => {
        output.write(`${ wrapText(`[${ label }] ${ message }`) }\n`);
    };

    const devServer = createDevServer({
        projectDirectory,
        port,
        environment,
        dotenv,
        log,
        stdout,
        stderr,
    });

    await devServer.start();

    log(
        `listening on http://localhost:${ devServer.port } ` +
        `(environment ${ environment }, app ${ projectDirectory }); press Ctrl-C to stop`,
    );

    return await waitForShutdown({ devServer, signals, log });
}


function waitForShutdown({ devServer, signals, log }) {
    return new Promise((resolve, reject) => {
        let isStopping = false;

        const removeListeners = () => {
            signals.off('SIGINT', onSignal);
            signals.off('SIGTERM', onSignal);
        };

        // Listeners stay installed while stopping, so a second Ctrl-C is
        // absorbed instead of killing the devserver mid-shutdown. The
        // child already got the terminal's SIGINT directly.
        function onSignal() {
            if (isStopping) {
                return;
            }

            isStopping = true;
            log('stopping');

            devServer.stop().then(() => {
                removeListeners();
                resolve(0);
            }, (cause) => {
                removeListeners();
                reject(cause);
            });
        }

        signals.on('SIGINT', onSignal);
        signals.on('SIGTERM', onSignal);
    });
}

function createDefaultDevServer(options) {
    const { projectDirectory, port, environment, dotenv, log, stdout, stderr } = options;

    const appProcess = new AppProcess({ projectDirectory, environment, dotenv, stdout, stderr, log });

    return new DevServer({ projectDirectory, port, appProcess, log });
}
