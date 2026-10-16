import process from 'node:process';
import path from 'node:path';
import runDevServer from '../../lib/devserver/run-dev-server.js';
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
            fileSystem,
            createDevServer,
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

        return await runDevServer({
            projectDirectory: this.#projectDirectory,
            port,
            environment,
            dotenv,
            label: 'kixx dev',
            missingServerHint: 'Pass a Kixx application directory, or run kixx dev start inside one.',
            output: this.#output,
            stdout: this.#stdout,
            stderr: this.#stderr,
            signals: this.#signals,
            fileSystem: this.#fileSystem,
            createDevServer: this.#createDevServer,
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
