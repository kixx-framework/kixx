import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import { assertNonEmptyString, isNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';

export default class PluginStore {

    #directory = null;
    #fileSystem = null;

    constructor(options) {
        this.#directory = options.directory;

        // Allow dependency injection for testing while
        // defaulting to the real file system API.
        this.#fileSystem = options.fileSystem || fileSystem;
    }

    async getPlugins(appPluginDirectory) {
        const pluginEntries = await this.#fs.readDirectory(this.directory);

        const directories = pluginEntries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(this.directory, entry.name));

        // The app plugin is loaded last.
        directories.push(appPluginDirectory);

        return directories.map((directory) => {
            return new Plugin(this.#fileSystem, directory);
        });
    }
}
