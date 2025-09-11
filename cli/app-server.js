import process from 'node:process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import DevelopmentServer from '../lib/application/development-server.js';
import Application from '../lib/application/application.js';
import { isNonEmptyString, isNumberNotNaN } from '../lib/assertions/mod.js';


const options = {
    // [optional] The path to the application directory
    dir: {
        short: 'd',
        type: 'string',
    },
    // [optional] The path to the application configuration file.
    config: {
        short: 'c',
        type: 'string',
    },
    // [optional] The path to the application secrets file.
    secrets: {
        short: 's',
        type: 'string',
    },
    // [optional] The path to the application secrets file.
    port: {
        short: 'p',
        type: 'string',
        default: '3001',
    },
    // [optional] The environment to run the server in.
    environment: {
        short: 'e',
        type: 'string',
        default: 'development',
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
            logger.error(`${ event.name }:${ event.message }; fatal error; exiting`);
            process.exit(1);
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

    server.startServer();
}
