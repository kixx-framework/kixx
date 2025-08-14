import path from 'node:path';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import { WrappedError, ValidationError } from '../errors/mod.js';
import { assertNonEmptyString } from '../assertions/mod.js';
import * as fileSystem from '../lib/file-system.js';


/**
 * @fileoverview Configuration file loader with JSONC support and fallback strategies
 *
 * This module provides configuration loading capabilities for Kixx applications,
 * supporting both JSON and JSONC (JSON with Comments) formats. It implements
 * intelligent fallback strategies for finding configuration files and handles
 * parsing errors with detailed validation feedback.
 *
 * Key Features:
 *   - JSONC parsing with comment support and trailing comma allowance
 *   - Automatic fallback from .jsonc to .json files
 *   - Secrets file loading with safe defaults
 *   - Detailed error reporting for parsing issues
 *   - Cross-platform path handling
 */
export default class ConfigStore {

    /**
     * @private
     * @type {Object}
     * File system interface for dependency injection during testing
     */
    #fs = null;

    /**
     * @private
     * @type {string|null}
     * Directory containing the application configuration files
     */
    #applicationDirectory = null;

    /**
     * Creates a new ConfigStore instance
     *
     * @param {Object} options - Configuration options
     * @param {string} options.currentWorkingDirectory - Current working directory path
     * @param {Object} [options.fileSystem] - Custom file system implementation for testing
     * @throws {AssertionError} When currentWorkingDirectory is not a non-empty string
     */
    constructor(options) {
        assertNonEmptyString(options.currentWorkingDirectory);

        // Allow dependency injection of file system for testing
        this.#fs = options.fileSystem || fileSystem;

        Object.defineProperties(this, {
            currentWorkingDirectory: {
                enumerable: true,
                value: options.currentWorkingDirectory,
            },
        });
    }

    /**
     * Gets the application directory path
     *
     * @returns {string|null} Directory containing application configuration files
     */
    get applicationDirectory() {
        return this.#applicationDirectory;
    }

    /**
     * Loads configuration from JSONC or JSON files with intelligent fallback
     *
     * Searches for configuration files in the following order:
     * 1. Specified filepath (if provided)
     * 2. kixx-config.jsonc in current working directory
     * 3. kixx-config.json in current working directory
     *
     * @async
     * @param {string} [filepath] - Specific configuration file path
     * @returns {Promise<Object>} Parsed configuration object
     * @throws {AssertionError} When filepath is provided but not a non-empty string
     * @throws {WrappedError} When no configuration files are found
     * @throws {ValidationError} When configuration file contains parsing errors
     */
    async loadLatestConfigJSON(filepath) {
        let values;

        if (filepath) {
            assertNonEmptyString(filepath);
            values = await this.loadSpecifiedConfigFile(filepath);
            this.#applicationDirectory = path.dirname(filepath);
            return values;
        }

        // Try JSONC format first (supports comments and trailing commas)
        filepath = path.join(this.currentWorkingDirectory, 'kixx-config.jsonc');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            this.#applicationDirectory = this.currentWorkingDirectory;
            return values;
        }

        // Fallback to standard JSON format
        filepath = path.join(this.currentWorkingDirectory, 'kixx-config.json');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            this.#applicationDirectory = this.currentWorkingDirectory;
            return values;
        }

        throw new WrappedError(
            `Could not find kixx-config.jsonc or kixx-config.json in ${ this.currentWorkingDirectory }`,
            { name: 'NotFoundError', code: 'ENOENT' }
        );
    }

    /**
     * Loads secrets from JSONC or JSON files with safe defaults
     *
     * Searches for secrets files in the following order:
     * 1. Specified filepath (if provided)
     * 2. .secrets.jsonc in application directory
     * 3. .secrets.json in application directory
     *
     * Returns empty object if no secrets files are found (safe default)
     *
     * @async
     * @param {string} [filepath] - Specific secrets file path
     * @returns {Promise<Object>} Parsed secrets object or empty object if not found
     * @throws {AssertionError} When filepath is provided but not a non-empty string
     * @throws {ValidationError} When secrets file contains parsing errors
     */
    async loadLatestSecretsJSON(filepath) {
        let values;

        if (filepath) {
            assertNonEmptyString(filepath);
            values = await this.attemptReadJSONFile(filepath);
            return values || {};
        }

        // Try JSONC format first
        filepath = path.join(this.applicationDirectory, '.secrets.jsonc');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            return values;
        }

        // Fallback to standard JSON format
        filepath = path.join(this.applicationDirectory, '.secrets.json');
        values = await this.attemptReadJSONFile(filepath);

        return values || {};
    }

    /**
     * Loads configuration from a specific file path
     *
     * @async
     * @param {string} filepath - Path to the configuration file
     * @returns {Promise<Object>} Parsed configuration object
     * @throws {WrappedError} When the specified file does not exist
     * @throws {ValidationError} When the configuration file contains parsing errors
     */
    async loadSpecifiedConfigFile(filepath) {
        const values = await this.attemptReadJSONFile(filepath);
        if (!values) {
            throw new WrappedError(
                `Specified config file does not exist ${ filepath }`,
                { name: 'NotFoundError', code: 'ENOENT' }
            );
        }
        return values;
    }

    /**
     * Attempts to read and parse a JSONC/JSON file
     *
     * Supports JSONC format with comments and trailing commas. Returns null
     * if the file doesn't exist, allowing for graceful fallback strategies.
     *
     * @async
     * @param {string} filepath - Path to the JSONC/JSON file
     * @returns {Promise<Object|null>} Parsed object or null if file doesn't exist
     * @throws {WrappedError} When file read fails for reasons other than non-existence
     * @throws {ValidationError} When JSONC parsing fails with detailed error information
     */
    async attemptReadJSONFile(filepath) {
        let json;
        try {
            json = await this.#fs.readUtf8File(filepath);
        } catch (cause) {
            throw new WrappedError(
                `Unexpected error while reading config file at ${ filepath }`,
                { cause }
            );
        }

        if (!json) {
            return null;
        }

        const errors = [];

        // Parse JSONC with comment support and trailing comma allowance
        const obj = jsonc.parse(json, errors, {
            disallowComments: false,
            allowTrailingComma: true,
            allowEmptyContent: true,
        });

        if (errors.length > 0) {
            const verror = new ValidationError(
                `JSON parsing errors in config file ${ filepath }`,
                { filepath }
            );

            // Collect all parsing errors for detailed feedback
            for (const parseError of errors) {
                verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
            }

            throw verror;
        }

        return obj;
    }
}
