import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';

/**
 * Manages directory paths for all major application resources.
 *
 * Provides centralized access to standard directories including routes, templates,
 * plugins, pages, and data stores. All paths are resolved relative to the
 * application root directory provided during construction.
 * @public
 */
export default class Paths {

    /**
     * Creates a path manager for a Kixx application with standard directory structure.
     * @param {string} applicationDirectory - Absolute path to the application root directory
     * @throws {AssertionError} When applicationDirectory is not a non-empty string
     */
    constructor(applicationDirectory) {
        assertNonEmptyString(applicationDirectory, 'applicationDirectory must be a non-empty string');

        /**
         * Absolute path to the application root directory.
         * @public
         * @type {string}
         */
        this.app_directory = applicationDirectory;

        /**
         * Absolute path to the routes directory containing route configuration files.
         * @public
         * @type {string}
         */
        this.routes_directory = path.join(this.app_directory, 'routes');

        /**
         * Absolute path to the public directory for static assets served by the web server.
         * @public
         * @type {string}
         */
        this.public_directory = path.join(this.app_directory, 'public');

        /**
         * Absolute path to the pages directory containing page data, markdown, and template files.
         * Directory structure mirrors the application's URL pathname structure.
         * @public
         * @type {string}
         */
        this.pages_directory = path.join(this.app_directory, 'pages');

        /**
         * Absolute path to the templates directory containing base HTML layout templates.
         * @public
         * @type {string}
         */
        this.templates_directory = path.join(this.app_directory, 'templates');

        /**
         * Absolute path to the app directory containing the main application plugin.
         * @public
         * @type {string}
         */
        this.app_plugin_directory = path.join(this.app_directory, 'app');

        /**
         * Absolute path to the plugins directory containing additional plugin modules.
         * @public
         * @type {string}
         */
        this.plugins_directory = path.join(this.app_directory, 'plugins');

        /**
         * Absolute path to the commands directory containing CLI command modules.
         * @public
         * @type {string}
         */
        this.commands_directory = path.join(this.app_directory, 'commands');

        /**
         * Absolute path to the data directory for application data files and databases.
         * @public
         * @type {string}
         */
        this.data_directory = path.join(this.app_directory, 'data');
    }
}
