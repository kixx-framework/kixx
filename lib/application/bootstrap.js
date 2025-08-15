import ConfigStore from './config-store.js';
import Config from './config.js';
import Paths from './paths.js';
import { assertNonEmptyString } from '../assertions/mod.js';

export default class Application {

    #configStore = null;
    #currentWorkingDirectory = null;
    #applicationDirectory = null;

    constructor(options) {
        const {
            currentWorkingDirectory,
            applicationDirectory,
        } = options;

        assertNonEmptyString(currentWorkingDirectory, 'An Application instance requires a currentWorkingDirectory path');

        this.#currentWorkingDirectory = currentWorkingDirectory;

        this.#configStore = new ConfigStore({
            currentWorkingDirectory,
            applicationDirectory,
        });
    }

    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
    }

    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    async initialize(options) {
        const {
            runtime,
            environment,
            configFilepath,
            secretsFilepath,
        } = options;

        const config = await this.loadConfiguration(environment, configFilepath, secretsFilepath);
        const paths = new Paths(config.applicationDirectory);

        this.#applicationDirectory = config.applicationDirectory;
    }

    async loadConfiguration(environment, configFilepath, secretsFilepath) {
        const configs = await this.#configStore.loadLatestConfigJSON(configFilepath);
        const secrets = await this.#configStore.loadLatestSecretsJSON(secretsFilepath);

        return Config.create(environment, configs, secrets, store.applicationDirectory);
    }
}
