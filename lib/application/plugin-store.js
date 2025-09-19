/**
 * @fileoverview Plugin discovery and dynamic loading system
 *
 * Provides utilities to scan plugin directories, build descriptors with pre-computed
 * paths, and dynamically import plugin modules with their register/initialize functions.
 */

import path from 'node:path';
import { WrappedError } from '../errors/mod.js';
import { assertNonEmptyString, isNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';

/**
 * @typedef {Object} PluginDescriptor
 * @property {string} name - Plugin name derived from directory name
 * @property {string} directory - Plugin's root directory path
 * @property {string|null} filepath - Path to main plugin file (plugin.js/mjs or app.js/mjs), null if none found
 * @property {Function|null} register - Plugin registration function, null until loadPlugins() is called
 * @property {Function|null} initialize - Plugin initialization function, null until loadPlugins() is called
 * @property {string} collectionsDirectory - Pre-computed path to collections subdirectory
 * @property {string} formsDirectory - Pre-computed path to forms subdirectory
 * @property {string} viewsDirectory - Pre-computed path to views subdirectory
 * @property {string} middlewareDirectory - Pre-computed path to middleware subdirectory
 * @property {string} requestHandlerDirectory - Pre-computed path to request-handlers subdirectory
 * @property {string} errorHandlerDirectory - Pre-computed path to error-handlers subdirectory
 */

/**
 * @typedef {Object} PluginStoreOptions
 * @property {string} directory - Directory path containing plugin subdirectories
 * @property {Object} [fileSystem] - File system implementation (defaults to built-in fs module)
 */

/**
 * Manages plugin discovery and dynamic loading from directory structures.
 */
export default class PluginStore {

    #fs = null;

    /**
     * @param {PluginStoreOptions} options - Configuration options
     * @throws {AssertionError} When options.directory is not a non-empty string
     */
    constructor(options) {
        assertNonEmptyString(options.directory);

        // Allow dependency injection for testing while defaulting to real file system
        this.#fs = options.fileSystem || fileSystem;

        Object.defineProperties(this, {
            directory: {
                enumerable: true,
                value: options.directory,
            },
        });
    }

    /**
     * Discovers all plugins and builds descriptors with pre-computed paths.
     * @async
     * @returns {Promise<PluginDescriptor[]>} Array of plugin descriptors with null register/initialize functions
     * @throws {Error} When plugins directory cannot be read or accessed
     */
    async getPlugins() {
        // Get all subdirectories in the plugins folder
        const pluginEntries = await this.#fs.readDirectory(this.directory);
        const pluginDirectories = pluginEntries.filter((entry) => entry.isDirectory());

        const plugins = [];

        // Build descriptor for each plugin directory without loading module code yet
        for (const pluginDirectory of pluginDirectories) {
            // eslint-disable-next-line no-await-in-loop
            const plugin = await this.getPlugin(path.join(this.directory, pluginDirectory.name));
            plugins.push(plugin);
        }

        return plugins;
    }

    /**
     * Builds a plugin descriptor for a single directory.
     * @async
     * @param {string} directory - Path to plugin directory
     * @returns {Promise<PluginDescriptor>} Plugin descriptor with pre-computed paths
     * @throws {Error} When directory cannot be read
     */
    async getPlugin(directory) {
        const entries = await this.#fs.readDirectory(directory);

        // Look for plugin.js, plugin.mjs, app.js, or app.mjs as entry point
        const pluginFilePattern = /(plugin|app).(js|mjs)$/;

        const pluginFile = entries.find((entry) => {
            return pluginFilePattern.test(entry.name) && entry.isFile();
        });

        return {
            name: path.basename(directory),
            directory,
            filepath: pluginFile ? path.join(directory, pluginFile.name) : null,
            // Functions populated later during loadPlugins() - kept null until then
            register: null,
            initialize: null,
            // Pre-computed paths to avoid repeated path.join operations during runtime
            collectionsDirectory: path.join(directory, 'collections'),
            formsDirectory: path.join(directory, 'forms'),
            viewsDirectory: path.join(directory, 'views'),
            middlewareDirectory: path.join(directory, 'middleware'),
            requestHandlerDirectory: path.join(directory, 'request-handlers'),
            errorHandlerDirectory: path.join(directory, 'error-handlers'),
        };
    }

    /**
     * Loads all plugins and imports their register/initialize functions.
     * @async
     * @param {string} appPluginDirectory - Path to the main application plugin directory
     * @returns {Promise<PluginDescriptor[]>} Plugin descriptors with loaded register/initialize functions
     * @throws {WrappedError} When plugin module import fails or contains syntax errors
     * @throws {Error} When plugin directories cannot be read
     */
    async loadPlugins(appPluginDirectory) {
        const plugins = await this.getPlugins();

        if (isNonEmptyString(appPluginDirectory)) {
            const stat = await this.#fs.getStats(appPluginDirectory);
            if (stat && stat.isDirectory()) {
                const appPlugin = await this.getPlugin(appPluginDirectory);
                // App plugin loads last to ensure its dependencies from other plugins are available
                plugins.push(appPlugin);
            }
        }

        for (const plugin of plugins) {
            // Not all plugins have a plugin.js or plugin.mjs file, so we skip them.
            if (!plugin.filepath) {
                continue;
            }

            try {
                // Convert file path to URL format to ensure cross-platform compatibility
                // eslint-disable-next-line no-await-in-loop
                const mod = await this.#fs.importAbsoluteFilepath(plugin.filepath);
                plugin.register = mod.register;
                plugin.initialize = mod.initialize;
            } catch (cause) {
                throw new WrappedError(`Error loading plugin from ${ plugin.filepath }`, { cause });
            }
        }

        return plugins;
    }
}
