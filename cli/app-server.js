import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Application from '../lib/application/application.js';
import ApplicationServer from '../lib/application/application-server.js';
import HttpRouter from '../lib/http-server/http-router.js';
import HttpRoutesStore from '../lib/http-routes-store/http-routes-store.js';
import { isNonEmptyString, isNumberNotNaN } from '../lib/assertions/mod.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(CLI_DIR, 'docs');


const options = {
    help: {
        short: 'h',
        type: 'boolean',
    },
    dir: {
        short: 'd',
        type: 'string',
    },
    config: {
        short: 'c',
        type: 'string',
    },
    secrets: {
        short: 's',
        type: 'string',
    },
    port: {
        short: 'p',
        type: 'string',
    },
    environment: {
        short: 'e',
        type: 'string',
        default: 'production',
    },
};


export async function main(args) {
    // Parse and validate command line arguments
    const { values } = parseArgs({
        args,
        options,
        strict: true,
        allowPositionals: true,
        allowNegative: true,
    });

    if (values.help) {
        // eslint-disable-next-line no-console
        console.log(readDocFile('app-server.md'));
        process.exit(1);
        return;
    }

    // Resolve file paths relative to the current working directory so the
    // server can be started from any directory
    const currentWorkingDirectory = process.cwd();

    const applicationDirectory = isNonEmptyString(values.dir) ? values.dir : null;
    const configFilepath = isNonEmptyString(values.config) ? path.resolve(values.config) : null;
    const secretsFilepath = isNonEmptyString(values.secrets) ? path.resolve(values.secrets) : null;

    let port = values.port ? parseInt(values.port, 10) : null;

    const environment = values.environment;

    // Initialize the Application which loads config, secrets, and sets up the logger
    const app = new Application({
        currentWorkingDirectory,
        applicationDirectory,
    });

    const runtime = { server: { name: 'server' } };

    const context = await app.initialize({
        runtime,
        environment,
        configFilepath,
        secretsFilepath,
    });

    const { logger } = context;

    // Set a descriptive process title for easier identification of the application process.
    // WARNING: Process names are truncated on some systems (e.g., 15 chars on Ubuntu Linux)
    // eslint-disable-next-line require-atomic-updates
    process.title = context.config.processName;

    const serverConfig = context.config.getNamespace('server');

    // Command line port takes precedence over config file for easier ad-hoc testing
    if (!isNumberNotNaN(port)) {
        port = serverConfig.port;
    }

    const router = new HttpRouter();

    router.on('error', ({ error, requestId }) => {
        if (!error.expected && !error.httpError) {
            logger.error('unexpected error', { requestId }, error);
        } else if (error.httpStatusCode >= 500) {
            const { httpStatusCode } = error;
            logger.error('internal server error', { requestId, httpStatusCode }, error);
        }
    });

    const routesStore = new HttpRoutesStore({
        app_directory: context.paths.app_directory,
        routes_directory: context.paths.routes_directory,
    });

    // Create the server and wire up event handlers for logging
    const server = new ApplicationServer(app, router, routesStore, { port });

    server.on('error', (event) => {
        logger.error(event.message, event.info, event.cause);

        // When we are not running in a dev server environment we crash on fatal errors.
        // Allow pending log writes to flush before terminating on fatal errors
        if (event.fatal) {
            setTimeout(() => {
                logger.error(`${ event.name }:${ event.message }; fatal error; exiting`);
                process.exit(1);
            }, 100);
        }
    });

    server.on('debug', (event) => {
        logger.debug(event.message, event.info, event.cause);
    });

    server.on('info', (event) => {
        logger.info(event.message, event.info, event.cause);
    });

    server.on('warning', (event) => {
        logger.warn(event.message, event.info, event.cause);
    });

    // Load application routes and middleware before starting the HTTP listener
    await server.load();

    server.startServer();
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
