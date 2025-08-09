/**
 * @fileoverview Path management utilities for Kixx applications
 *
 * This module provides centralized path resolution and management for all
 * major application resources including configuration, routes, templates,
 * plugins, and data stores. It supports plugin discovery and flexible
 * file system abstraction for testing.
 */

import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';

/**
 * @typedef {Object} PluginMetadata
 * @property {string} directory - Absolute path to the plugin's root directory
 * @property {string} filepath - Absolute path to the main plugin module file
 * @property {string} middlewareDirectory - Absolute path to plugin middleware directory
 * @property {string} requestHandlerDirectory - Absolute path to plugin request handlers directory
 * @property {string} errorHandlerDirectory - Absolute path to plugin error handlers directory
 */

/**
 * Paths
 * =====
 *
 * The Paths class provides a structured interface for resolving and managing
 * important directory and file paths within a Kixx application. It centralizes
 * the logic for constructing absolute paths to configuration files, routes,
 * templates, plugins, data stores, and other key resources, based on the
 * application's root directory.
 *
 * Core Features:
 *   - Computes and exposes absolute paths for all major application resources.
 *   - Supports injection of a custom file system abstraction for testing or extension.
 *   - Provides a utility for discovering plugin modules and their associated directories.
 *   - Can be instantiated directly or from a configuration file path.
 *
 * Usage Example:
 *   const paths = new Paths('/my/app');
 *   const plugins = await paths.getPlugins();
 *
 *   // Or, from a config file path:
 *   const paths = Paths.fromConfigFilepath('/my/app/config.json');
 */
export default class Paths {
    /**
     * @private
     * @type {Object}
     * File system abstraction for reading directories, etc.
     */
    #fs = null;

    /**
     * Creates a new Paths instance with resolved absolute paths for all application resources
     * @param {string} applicationDirectory - The root directory of the application
     * @param {Object} [options] - Configuration options
     * @param {Object} [options.fileSystem] - Custom file system abstraction for testing
     * @throws {AssertionError} When applicationDirectory is not a non-empty string
     */
    constructor(applicationDirectory, options = {}) {
        assertNonEmptyString(applicationDirectory, 'applicationDirectory must be a non-empty string');

        // Inject custom file system for testing or use default
        this.#fs = options.fileSystem || fileSystem;

        /**
         * The root directory path for the application.
         * @type {string}
         */
        this.app_directory = applicationDirectory;

        // Configuration and routing paths
        /**
         * File path to the application's virtual hosts root configuration file.
         * @type {string}
         */
        this.vhosts_config = path.join(this.app_directory, 'virtual-hosts.json');

        /**
         * Directory path to the application's routes configuration files.
         * @type {string}
         */
        this.routes_directory = path.join(this.app_directory, 'routes');

        /**
         * Directory path to the application's public assets.
         * @type {string}
         */
        this.public_directory = path.join(this.app_directory, 'public');

        // Page and template system paths
        /**
         * File path to the site-wide page data JSON file.
         * @type {string}
         */
        this.site_page_data_filepath = path.join(this.app_directory, 'site-page-data.json');

        /**
         * Directory tree where page data files (index.json) and page templates (index.html) are stored.
         * The directory structure represents pathnames for the server.
         * @type {string}
         */
        this.pages_directory = path.join(this.app_directory, 'pages');

        /**
         * Directory containing base HTML templates that page templates extend.
         * @type {string}
         */
        this.templates_directory = path.join(this.app_directory, 'templates', 'templates');

        /**
         * Directory containing template helper modules.
         * @type {string}
         */
        this.helpers_directory = path.join(this.app_directory, 'templates', 'helpers');

        /**
         * Directory containing partial HTML templates that can be included in pages.
         * @type {string}
         */
        this.partials_directory = path.join(this.app_directory, 'templates', 'partials');

        // Plugin and extension system paths
        /**
         * Directory containing plugin modules.
         * @type {string}
         */
        this.plugins_directory = path.join(this.app_directory, 'plugins');

        /**
         * Directory containing command modules.
         * @type {string}
         */
        this.commands_directory = path.join(this.app_directory, 'commands');

        // Data storage paths - all under 'data' for logical organization
        /**
         * Directory containing data files.
         * @type {string}
         */
        this.data_directory = path.join(this.app_directory, 'data');

        /**
         * Directory containing datastore files.
         * @type {string}
         */
        this.kv_store_directory = path.join(this.app_directory, 'data', 'kv-store');

        /**
         * Directory containing object files.
         * @type {string}
         */
        this.object_store_directory = path.join(this.app_directory, 'data', 'objects');

        /**
         * Directory containing job files.
         * @type {string}
         */
        this.job_directory = path.join(this.app_directory, 'data', 'jobs');
    }

    // TODO: Move getPlugins to ApplicationEnvironment
    async getPlugins() {
        // Get all subdirectories in the plugins folder
        const pluginDirectories = await this.#fs.readDirectory(this.plugins_directory);

        const plugins = [];

        // Process each potential plugin directory
        for (const pluginDirectory of pluginDirectories) {
            // Read contents of each plugin directory to find the main plugin file
            // eslint-disable-next-line no-await-in-loop
            const entries = await this.#fs.readDirectory(pluginDirectory);

            const filepath = entries.find((entry) => {
                const basename = path.basename(entry);
                return basename === 'plugin.js' || basename === 'plugin.mjs';
            });

            // Build plugin metadata with standardized directory structure
            // Plugin architecture expects these specific subdirectories
            plugins.push({
                directory: pluginDirectory,
                filepath,
                // Standard plugin subdirectories for different handler types
                middlewareDirectory: path.join(pluginDirectory, 'middleware'),
                requestHandlerDirectory: path.join(pluginDirectory, 'request-handlers'),
                errorHandlerDirectory: path.join(pluginDirectory, 'error-handlers'),
            });
        }

        return plugins;
    }

    /**
     * Creates a Paths instance using a configuration file's directory as the application root
     *
     * Convenience factory method that extracts the parent directory from a config file path
     * and uses it as the application directory for the new Paths instance.
     *
     * @param {string} configFilepath - Absolute path to the application's configuration file
     * @param {Object} [options] - Configuration options passed to the constructor
     * @param {Object} [options.fileSystem] - Custom file system abstraction for testing
     * @returns {Paths} New Paths instance rooted at the config file's directory
     * @throws {AssertionError} When configFilepath is not a non-empty string
     *
     * @example
     * const paths = Paths.fromConfigFilepath('/my/app/config.json');
     * console.log(paths.app_directory); // '/my/app'
     */
    static fromConfigFilepath(configFilepath, options = {}) {
        // Extract parent directory from config file path to use as app root
        return new Paths(path.dirname(configFilepath), options);
    }
}
