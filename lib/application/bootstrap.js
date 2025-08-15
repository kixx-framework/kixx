import ConfigStore from './config-store.js';
import Config from './config.js';

export async function loadConfiguration(options) {
    const {
        environment,
        currentWorkingDirectory,
        applicationDirectory,
        configFilepath,
        secretsFilepath,
    } = options;

    const store = new ConfigStore({
        currentWorkingDirectory,
        applicationDirectory,
    });

    const configs = await store.loadLatestConfigJSON(configFilepath);
    const secrets = await store.loadLatestSecretsJSON(secretsFilepath);

    return Config.create(environment, configs, secrets, store.applicationDirectory);
}
