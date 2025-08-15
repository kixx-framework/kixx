import path from 'node:path';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import { WrappedError, ValidationError } from '../errors/mod.js';
import { assertNonEmptyString, isNonEmptyString } from '../assertions/mod.js';
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
     * @private
     * @type {string|null}
     * Current working directory path
     */
    #currentWorkingDirectory = null;

    /**
     * Creates a new ConfigStore instance
     *
     * @param {Object} options - Configuration options
     * @param {string} [options.currentWorkingDirectory] - Current working directory path
     * @param {string} [options.applicationDirectory] - Application directory path
     * @param {Object} [options.fileSystem] - Custom file system implementation for testing
     */
    constructor(options) {
        // Allow dependency injection of file system for testing
        this.#fs = options.fileSystem || fileSystem;

        if (isNonEmptyString(options.currentWorkingDirectory)) {
            this.#currentWorkingDirectory = options.currentWorkingDirectory;
        }

        if (isNonEmptyString(options.applicationDirectory)) {
            this.#applicationDirectory = options.applicationDirectory;
        }
    }

    /**
     * Gets the current working directory path
     *
     * @returns {string|null} Current working directory path
     */
    get currentWorkingDirectory() {
        return this.#currentWorkingDirectory;
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
     * 2. kixx-config.jsonc in application directory
     * 3. kixx-config.json in application directory
     *
     * The application directory is determined by:
     * - Directory of specified filepath (if provided)
     * - Current working directory (if no filepath and no application directory set)
     * - Previously set application directory
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
            values = await this.attemptReadJSONFile(filepath);
            if (!values) {
                throw new WrappedError(
                    `Specified config file does not exist ${ filepath }`,
                    { name: 'NotFoundError', code: 'ENOENT' }
                );
            }
            // Set application directory from config file location if not already set
            if (!isNonEmptyString(this.#applicationDirectory)) {
                this.#applicationDirectory = path.dirname(filepath);
            }
            return values;
        }

        // Default to current working directory if application directory not set
        if (!isNonEmptyString(this.#applicationDirectory)) {
            assertNonEmptyString(this.#currentWorkingDirectory);
            this.#applicationDirectory = this.#currentWorkingDirectory;
        }

        // Try JSONC format first (supports comments and trailing commas)
        filepath = path.join(this.#applicationDirectory, 'kixx-config.jsonc');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            return values;
        }

        // Fallback to standard JSON format
        filepath = path.join(this.#applicationDirectory, 'kixx-config.json');
        values = await this.attemptReadJSONFile(filepath);

        if (values) {
            return values;
        }

        throw new WrappedError(
            `Could not find kixx-config.jsonc or kixx-config.json in ${ this.#applicationDirectory }`,
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
     * The application directory is determined by:
     * - Directory of specified filepath (if provided)
     * - Current working directory (if no filepath and no application directory set)
     * - Previously set application directory
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
            // Set application directory from secrets file location if not already set
            if (!isNonEmptyString(this.#applicationDirectory)) {
                this.#applicationDirectory = path.dirname(filepath);
            }
            return values || {};
        }

        // Default to current working directory if application directory not set
        if (!isNonEmptyString(this.#applicationDirectory)) {
            assertNonEmptyString(this.#currentWorkingDirectory);
            this.#applicationDirectory = this.#currentWorkingDirectory;
        }

        // Try JSONC format first (supports comments and trailing commas)
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
            const verror = new ValidationError(`JSON parsing errors in config file ${ filepath }`);

            // Collect all parsing errors for detailed feedback
            for (const parseError of errors) {
                verror.push(jsonc.ParseErrorCode[parseError.error], parseError.offset);
            }

            throw verror;
        }

        return obj;
    }
}
