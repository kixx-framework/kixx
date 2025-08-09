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

export default class Paths {

    constructor(applicationDirectory) {
        assertNonEmptyString(applicationDirectory, 'applicationDirectory must be a non-empty string');

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
         * Directory tree where page data, markedown, and template files are stored.
         * The directory structure represents pathnames for the server.
         * @type {string}
         */
        this.pages_directory = path.join(this.app_directory, 'pages');

        /**
         * Directory containing base HTML templates.
         * @type {string}
         */
        this.templates_directory = path.join(this.app_directory, 'templates', 'templates');

        /**
         * Directory containing template helper modules.
         * @type {string}
         */
        this.helpers_directory = path.join(this.app_directory, 'templates', 'helpers');

        /**
         * Directory containing partial HTML templates.
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
}
