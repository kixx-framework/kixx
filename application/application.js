import { WrappedError } from '../errors/mod.js';
import { isFunction } from '../assertions/mod.js';
import Logger from '../logger/mod.js';
import Config from './config.js';
import Paths from './paths.js';
import Context from './context.js';



export async function initialize(configFilepath, environment) {
    let config;
    try {
        config = await Config.loadConfigs(configFilepath, environment);
    } catch (error) {
        throw new WrappedError(`Error loading application config from ${ configFilepath }`, { cause: error });
    }

    const paths = Paths.fromConfigFilepath(configFilepath);
    const logger = createLogger(config);
    const context = await Context.load(config, paths, logger);

    await initializePlugins(context);

    return context;
}

export function createLogger(config) {
    const options = config.getNamespace('logger');

    const logger = new Logger({
        name: config.name,
        level: options.level || 'debug',
        mode: options.mode || 'console',
    });

    config.on('change', () => {
        const newConfig = config.getNamespace('logger');

        if (newConfig.level) {
            logger.level = newConfig.level;
        }
        if (newConfig.mode) {
            logger.mode = newConfig.mode;
        }
    });

    return logger;
}

export async function initializePlugins(context) {
    const plugins = await context.paths.getPlugins();

    for (const { filepath } of plugins) {
        let mod;
        try {
            // eslint-disable-next-line no-await-in-loop
            mod = await import(filepath);
        } catch (cause) {
            throw new WrappedError(`Error loading plugin from ${ filepath }`, { cause });
        }

        if (isFunction(mod.register)) {
            mod.register(context);
        }
        if (isFunction(mod.initialize)) {
            // eslint-disable-next-line no-await-in-loop
            await mod.initialize(context);
        }
    }
}
