import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { parseArgs } from 'node:util';
import DevelopmentServer from '../lib/application/development-server.js';
import Application from '../lib/application/application.js';
import { isNonEmptyString } from '../lib/assertions/mod.js';


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

    let applicationDirectory;
    if (isNonEmptyString(values.dir)) {
        applicationDirectory = values.dir;
    }

    let configFilepath;
    if (isNonEmptyString(values.config)) {
        configFilepath = path.resolve(values.config);
    } else {
        configFilepath = path.join(process.cwd(), 'kixx-config.jsonc');
        const fileExists = await doesFileExist(configFilepath);
        if (!fileExists) {
            configFilepath = path.join(process.cwd(), 'kixx-config.json');
        }
    }

    let secretsFilepath;
    if (isNonEmptyString(values.secrets)) {
        secretsFilepath = path.resolve(values.config);
    } else {
        secretsFilepath = path.join(process.cwd(), '.secrets.jsonc');
        const fileExists = await doesFileExist(secretsFilepath);
        if (!fileExists) {
            secretsFilepath = path.join(process.cwd(), '.secrets.json');
        }
    }

    const port = parseInt(values.port, 10);

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

async function doesFileExist(filepath) {
    try {
        const stat = await fsp.stat(filepath);
        return stat.isFile();
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
