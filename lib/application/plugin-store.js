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
 * @typedef {Object} PluginInfo
 * @property {string} directory - Plugin's root directory path
 * @property {string} filepath - Path to the plugin's main file (plugin.js or plugin.mjs)
 * @property {Function|null} register - Plugin registration function
 * @property {Function|null} initialize - Plugin initialization function
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
 * Manages discovery and loading of plugin modules from a designated directory.
 * Each plugin is expected to be in its own subdirectory with a main file named
 * either 'plugin.js' or 'plugin.mjs'.
 */
export default class PluginStore {

    #fs = null;

    /**
     * Creates a new PluginStore instance.
     * @param {PluginStoreOptions} options - Configuration options
     * @throws {AssertionError} When directory is not a non-empty string
     */
    constructor(options) {
        assertNonEmptyString(options.directory);

        // Inject custom file system for testing or use default
        this.#fs = options.fileSystem || fileSystem;

        Object.defineProperties(this, {
            directory: {
                enumerable: true,
                value: options.directory,
            },
        });
    }

    /**
     * Discovers plugin directories and returns plugin information without loading modules.
     * @returns {Promise<PluginInfo[]>} Array of plugin information objects
     */
    async getPluginPaths() {
        // Get all subdirectories in the plugins folder
        const pluginEntries = await this.#fs.readDirectory(this.directory);
        const pluginDirectories = pluginEntries.filter((entry) => entry.isDirectory());

        const plugins = [];

        // Read contents of each plugin directory
        for (const pluginDirectory of pluginDirectories) {
            const directory = path.join(this.directory, pluginDirectory.name);
            // eslint-disable-next-line no-await-in-loop
            const entries = await this.#fs.readDirectory(directory);

            const pluginFile = entries.find((entry) => {
                const isPluginFile = entry.name === 'plugin.js' || entry.name === 'plugin.mjs';
                return isPluginFile && entry.isFile();
            });

            plugins.push({
                directory,
                filepath: pluginFile ? path.join(directory, pluginFile.name) : null,
                // A placeholder for the plugin registration function
                register: null,
                // A placeholder for the plugin initialization function
                initialize: null,
                // Standard plugin subdirectories for different handler types
                middlewareDirectory: path.join(directory, 'middleware'),
                requestHandlerDirectory: path.join(directory, 'request-handlers'),
                errorHandlerDirectory: path.join(directory, 'error-handlers'),
            });
        }

        return plugins;
    }

    /**
     * Loads all discovered plugins by dynamically importing their main modules.
     * @returns {Promise<PluginInfo[]>} Array of loaded plugin information with register and initialize functions
     * @throws {WrappedError} When plugin module fails to load
     */
    async loadPlugins() {
        const plugins = await this.getPluginPaths();

        for (const plugin of plugins) {
            // Not all plugins have a plugin.js or plugin.mjs file, so we skip them.
            if (!plugin.filepath) {
                continue;
            }

            try {
                // We pass a file URL to the dynamic import for Windows compatibility.
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
