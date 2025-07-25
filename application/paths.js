import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


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
     * Construct a new Paths instance.
     *
     * @param {string} applicationDirectory - The root directory of the application.
     * @param {Object} [options] - Optional settings.
     * @param {Object} [options.fileSystem] - Optional file system abstraction.
     * @throws {AssertionError} If applicationDirectory is not a non-empty string.
     */
    constructor(applicationDirectory, options = {}) {
        assertNonEmptyString(applicationDirectory, 'applicationDirectory must be a non-empty string');

        this.#fs = options.fileSystem || fileSystem;

        /**
         * The root directory path for the application.
         * @type {string}
         */
        this.app_directory = applicationDirectory;

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

    /**
     * Discovers available plugins in the plugins directory.
     *
     * Each plugin is expected to be a directory containing a file ending with 'plugin.js'.
     * Returns an array of plugin metadata objects, each with:
     *   - directory: The plugin's root directory.
     *   - filepath: The main plugin module file.
     *   - middlewareDirectory: Directory for plugin middleware modules.
     *   - requestHandlerDirectory: Directory for plugin request handlers.
     *   - errorHandlerDirectory: Directory for plugin error handlers.
     *
     * @returns {Promise<Array<Object>>} Array of plugin metadata objects.
     */
    async getPlugins() {
        const pluginDirectories = await this.#fs.readDirectory(this.plugins_directory);

        const plugins = [];

        for (const pluginDirectory of pluginDirectories) {
            // eslint-disable-next-line no-await-in-loop
            const entries = await this.#fs.readDirectory(pluginDirectory);
            const filepath = entries.find((entry) => entry.endsWith('plugin.js'));

            if (filepath) {
                plugins.push({
                    directory: pluginDirectory,
                    filepath,
                    middlewareDirectory: path.join(pluginDirectory, 'middleware'),
                    requestHandlerDirectory: path.join(pluginDirectory, 'request-handlers'),
                    errorHandlerDirectory: path.join(pluginDirectory, 'error-handlers'),
                });
            }
        }

        return plugins;
    }

    /**
     * Creates a Paths instance from a configuration file path.
     *
     * @param {string} configFilepath - The absolute path to the application's config file.
     * @param {Object} [options] - Optional settings.
     * @returns {Paths} A new Paths instance rooted at the config file's directory.
     */
    static fromConfigFilepath(configFilepath, options = {}) {
        return new Paths(path.dirname(configFilepath), options);
    }
}
