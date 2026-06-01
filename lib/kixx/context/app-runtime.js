/**
 * Immutable descriptor for the application's active runtime mode.
 * @module AppRuntime
 */

import {
    AssertionError,
    assertNonEmptyString,
    isObjectNotNull,
} from '../assertions/mod.js';


/**
 * Describes whether the application is running as a CLI command or server process.
 */
export default class AppRuntime {

    /**
     * CLI command name for command runtimes.
     * @name command
     * @type {string|undefined}
     */

    /**
     * Server instance or adapter for server runtimes.
     * @name server
     * @type {Object|undefined}
     */

    /**
     * @param {Object} options - Runtime mode options
     * @param {string} [options.command] - CLI command name for command runtimes
     * @param {Object} [options.server] - Server instance or adapter for server runtimes
     * @param {Object} [options.build] - The latest build configuration
     * @throws {AssertionError} When neither or both runtime modes are provided
     * @throws {AssertionError} When command is not a non-empty string
     * @throws {AssertionError} When server is not an object
     */
    constructor(options) {
        const { command, server, build } = options ?? {};
        const hasCommand = typeof command !== 'undefined';
        const hasServer = typeof server !== 'undefined';

        if (hasCommand === hasServer) {
            throw new AssertionError('AppRuntime requires exactly one of options.command or options.server');
        }

        if (hasCommand) {
            assertNonEmptyString(command, 'AppRuntime command must be a string');
            Object.defineProperty(this, 'command', {
                enumerable: true,
                value: command,
            });
        } else {
            if (!isObjectNotNull(server)) {
                throw new AssertionError('AppRuntime server must be an Object');
            }

            Object.defineProperty(this, 'server', {
                enumerable: true,
                value: server,
            });
        }

        if (build) {
            Object.defineProperty(this, 'build', {
                enumerable: true,
                value: build,
            });
        }
    }
}
