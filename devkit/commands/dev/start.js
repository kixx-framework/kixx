import process from 'node:process';
import path from 'node:path';
import defaultFileSystem from '../../lib/file-system.js';
import { AppProcess } from '../../lib/devserver/app-process.js';
import { DevServer } from '../../lib/devserver/dev-server.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';


const DEFAULT_PORT = 2026;
const DEFAULT_ENVIRONMENT = 'development';


export default class DevStartCommand {

    static description = `
        Run the project's node-server.js behind a local proxy. The app server
        restarts on the next request after a server-side file changes, and an
        error page shows when it fails to start.
    `;

    static options = {
        port: {
            type: 'string',
            short: 'p',
            description: `Port for the devserver to listen on (default ${ DEFAULT_PORT })`,
        },
        environment: {
            type: 'string',
            short: 'e',
            description: `Application environment (default ${ DEFAULT_ENVIRONMENT })`,
        },
        dotenv: {
            type: 'string',
            description: 'Dotenv file passed to node-server.js, relative to the current directory',
        },
    };

    #projectDirectory;
    #output;
    #stdout;
    #stderr;
    #signals;
    #fileSystem;
    #createDevServer;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            stdout = process.stdout,
            stderr = process.stderr,
            signals = process,
            fileSystem = defaultFileSystem,
            createDevServer = createDefaultDevServer,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#signals = signals;
        this.#fileSystem = fileSystem;
        this.#createDevServer = createDevServer;
    }

    async run(options) {
        const port = parsePort(options?.port);
        const environment = options?.environment || DEFAULT_ENVIRONMENT;

        // The child runs in the project directory, so a relative path would
        // resolve against the wrong directory there.
        const dotenv = options?.dotenv ? path.resolve(options.dotenv) : undefined;

        const serverScript = path.join(this.#projectDirectory, 'node-server.js');

        if (!await this.#fileSystem.isFile(serverScript)) {
            throw new UsageError(
                `No app server found at ${ serverScript }. ` +
                'Run kixx dev start inside a Kixx application directory.',
            );
        }

        // Watcher paths are relative to the real path, so resolve symlinks
        // before the watcher starts.
        const projectDirectory = await this.#fileSystem.realpath(this.#projectDirectory);

        const log = (message) => {
            this.#output.write(`${ wrapText(`[kixx dev] ${ message }`) }\n`);
        };

        const devServer = this.#createDevServer({
            projectDirectory,
            port,
            environment,
            dotenv,
            log,
            stdout: this.#stdout,
            stderr: this.#stderr,
        });

        await devServer.start();

        log(
            `listening on http://localhost:${ devServer.port } ` +
            `(environment ${ environment }, app ${ projectDirectory }); press Ctrl-C to stop`,
        );

        return await this.#waitForShutdown(devServer, log);
    }

    #waitForShutdown(devServer, log) {
        const signals = this.#signals;

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
}


function parsePort(value) {
    if (value === undefined) {
        return DEFAULT_PORT;
    }

    const port = /^\d+$/.test(value) ? Number.parseInt(value, 10) : NaN;

    if (Number.isNaN(port) || port > 65535) {
        throw new UsageError(`The --port value must be an integer from 0 to 65535 (got "${ value }")`);
    }

    return port;
}

function createDefaultDevServer(options) {
    const { projectDirectory, port, environment, dotenv, log, stdout, stderr } = options;

    const appProcess = new AppProcess({ projectDirectory, environment, dotenv, stdout, stderr, log });

    return new DevServer({ projectDirectory, port, appProcess, log });
}
