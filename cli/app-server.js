import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import DevelopmentServer from '../lib/application/development-server.js';
import Application from '../lib/application/application.js';
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
        default: '3001',
    },
    environment: {
        short: 'e',
        type: 'string',
        default: 'production',
    },
};


export async function main(args) {
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

    const currentWorkingDirectory = process.cwd();

    const applicationDirectory = isNonEmptyString(values.dir) ? values.dir : null;
    const configFilepath = isNonEmptyString(values.config) ? path.resolve(values.config) : null;
    const secretsFilepath = isNonEmptyString(values.secrets) ? path.resolve(values.secrets) : null;

    let port = values.port ? parseInt(values.port, 10) : null;

    const environment = values.environment;

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

    // eslint-disable-next-line require-atomic-updates
    process.title = `node-${ context.config.processName }`;
    // NOTE: We've seen process names get truncated.
    // For example, on Ubuntu Linux this is truncated to 15 characters.

    const serverConfig = context.config.getNamespace('server');

    // Allow the port number provided on the command line to override the
    // port number from the configuration.
    if (!isNumberNotNaN(port)) {
        port = serverConfig.port;
    }

    const server = new DevelopmentServer(app, { port });

    server.on('error', (event) => {
        logger.error(event.message, event.info, event.cause);

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

    // Load configs and routes to sanity check them. If the configuration or
    // routes are not valid, an error will be thrown here instead of
    // waiting for the first request.
    await server.preload();

    server.startServer();
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
