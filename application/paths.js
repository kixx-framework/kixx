import path from 'node:path';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


export default class Paths {

    #fs = null;

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
        this.application_vhosts_config = path.join(this.app_directory, 'virtual-hosts.json');

        /**
         * Directory path to the application's routes configuration files.
         * @type {string}
         */
        this.application_routes_directory = path.join(this.app_directory, 'routes');

        /**
         * File path to the site-wide page data JSON file.
         * @type {string}
         */
        this.application_public_directory = path.join(this.app_directory, 'public');

        /**
         * File path to the site-wide page data JSON file.
         * @type {string}
         */
        this.application_site_page_data_filepath = path.join(this.app_directory, 'site-page-data.json');

        /**
         * Directory tree where page data files (index.json) and page templates (index.html) are stored.
         * The directory structure represents pathnames for the server.
         * @type {string}
         */
        this.application_pages_directory = path.join(this.app_directory, 'pages');

        /**
         * Directory containing base HTML templates that page templates extend.
         * @type {string}
         */
        this.application_templates_directory = path.join(this.app_directory, 'templates', 'templates');

        /**
         * Directory containing partial HTML templates that can be included in pages.
         * @type {string}
         */
        this.application_partials_directory = path.join(this.app_directory, 'templates', 'partials');

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
         * Directory containing datastore files.
         * @type {string}
         */
        this.kv_store_directory = path.join(this.app_directory, 'data', 'kv-store');

        /**
         * Directory containing job files.
         * @type {string}
         */
        this.job_directory = path.join(this.app_directory, 'data', 'jobs');
    }

    async getPlugins() {
        const pluginDirectories = await this.#fs.readDirectory(this.plugins_directory, { includeFullPaths: true });

        const plugins = [];

        for (const pluginDirectory of pluginDirectories) {
            // eslint-disable-next-line no-await-in-loop
            const entries = await this.#fs.readDirectory(pluginDirectory);
            const pluginFilename = entries.find((entry) => entry.endsWith('plugin.js'));

            if (pluginFilename) {
                plugins.push({
                    directory: pluginDirectory,
                    filepath: path.join(pluginDirectory, pluginFilename),
                    middlewareDirectory: path.join(pluginDirectory, 'middleware'),
                    requestHandlerDirectory: path.join(pluginDirectory, 'request-handlers'),
                    errorHandlerDirectory: path.join(pluginDirectory, 'error-handlers'),
                });
            }
        }

        return plugins;
    }

    static fromConfigFilepath(configFilepath, options = {}) {
        return new Paths(path.dirname(configFilepath), options);
    }
}
