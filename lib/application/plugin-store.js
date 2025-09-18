/**
 * @fileoverview Plugin management and loading utilities for Kixx applications
 *
 * This module provides functionality to discover, load, and manage plugin modules
 * from a designated plugins directory.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WrappedError } from '../errors/mod.js';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';

/**
 * @typedef {Object} PluginDescriptor
 * @property {string} name - Plugin name derived from directory name
 * @property {string} directory - Plugin's root directory path
 * @property {string|null} filepath - Path to the plugin's main file (plugin.js or plugin.mjs), null if not found
 * @property {Function|null} register - Plugin registration function, null until loaded
 * @property {Function|null} initialize - Plugin initialization function, null until loaded
 * @property {string} collectionsDirectory - Path to collections directory
 * @property {string} formsDirectory - Path to forms directory
 * @property {string} middlewareDirectory - Path to middleware handlers
 * @property {string} requestHandlerDirectory - Path to request handlers
 * @property {string} errorHandlerDirectory - Path to error handlers
 */

/**
 * @typedef {Object} PluginStoreOptions
 * @property {string} directory - Directory path containing plugin subdirectories
 * @property {Object} [fileSystem] - Custom file system implementation for testing
 */

/**
 * Discovers and loads plugin modules from a designated directory structure.
 */
export default class PluginStore {

    #fs = null;

    /**
     * @param {PluginStoreOptions} options - Configuration options
     * @throws {AssertionError} When directory is not a non-empty string
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
     * Scans the plugins directory and builds descriptors without loading module code.
     * @async
     * @returns {Promise<PluginDescriptor[]>} Plugin descriptors with pre-computed paths
     * @throws {Error} When plugin directory cannot be read
     */
    async getPluginPaths() {
        // Get all subdirectories in the plugins folder
        const pluginEntries = await this.#fs.readDirectory(this.directory);
        const pluginDirectories = pluginEntries.filter((entry) => entry.isDirectory());

        const plugins = [];

        // Process each plugin directory to build descriptor objects
        for (const pluginDirectory of pluginDirectories) {
            const directory = path.join(this.directory, pluginDirectory.name);
            // eslint-disable-next-line no-await-in-loop
            const entries = await this.#fs.readDirectory(directory);

            const pluginFile = entries.find((entry) => {
                const isPluginFile = entry.name === 'plugin.js' || entry.name === 'plugin.mjs';
                return isPluginFile && entry.isFile();
            });

            plugins.push({
                name: pluginDirectory.name,
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
            });
        }

        return plugins;
    }

    /**
     * Dynamically imports plugin modules and populates register/initialize functions.
     * @async
     * @returns {Promise<PluginDescriptor[]>} Plugin descriptors with loaded functions
     * @throws {WrappedError} When plugin module import fails or contains syntax errors
     * @throws {Error} When plugin directory cannot be read
     */
    async loadPlugins() {
        const plugins = await this.getPluginPaths();

        for (const plugin of plugins) {
            // Not all plugins have a plugin.js or plugin.mjs file, so we skip them.
            if (!plugin.filepath) {
                continue;
            }

            try {
                // Convert file path to URL format to ensure cross-platform compatibility
                // eslint-disable-next-line no-await-in-loop
                const mod = await import(pathToFileURL(plugin.filepath));
                plugin.register = mod.register;
                plugin.initialize = mod.initialize;
            } catch (cause) {
                throw new WrappedError(`Error loading plugin from ${ plugin.filepath }`, { cause });
            }
        }

        return plugins;
    }
}
