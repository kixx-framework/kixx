import process from 'node:process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ApplicationServer from '../application/application-server.js';
import * as Application from '../application/application.js';
import { isNonEmptyString } from '../assertions/mod.js';


const options = {
    // The path to the application configuration file.
    config: {
        short: 'c',
        type: 'string',
    },
    // The environment to run the server in.
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

    let configFilepath;
    if (isNonEmptyString(values.config)) {
        configFilepath = path.resolve(values.config);
    } else {
        configFilepath = path.join(process.cwd(), 'kixx-config.json');
    }

    const runtime = { server: { name: 'dev-server' } };
    const context = await Application.initialize(runtime, configFilepath, values.environment);

    // eslint-disable-next-line require-atomic-updates
    process.title = `node-${ context.config.procName }`;

    const { config } = context;
    const serverConfig = config.getNamespace('server');

    const server = await loadHttpAppServer(context, {
        port: serverConfig.port || 3000,
    });

    server.startServer();

    // The JobQueue is only started when a server is also running.
    const jobQueue = context.getService('kixx.JobQueue');
    jobQueue.start({ delay: 5000 });
}

async function loadHttpAppServer(context, opts) {
    const { logger } = context;

    const server = await ApplicationServer.load(context, opts);

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

    return server;
}
