import UsageError from './usage-error.js';
import { assertNonEmptyString } from './vendor/kixx-assert/mod.js';


/**
 * Thrown when a registered command is not built yet. Exits 4.
 */
export class CommandNotAvailableError extends UsageError {
    static code = 'CommandNotAvailable';
}

/**
 * Creates the class registered for a command that is not available in this
 * version of kixx-dev. It reserves the name, shows up in help marked as not
 * available, and fails with its own exit code when run.
 *
 * The runner does not parse a placeholder's arguments: its real options don't
 * exist yet, so any flag must reach the same answer.
 * @param {string} description - One line shown in help
 * @returns {Function} A command class with `available = false`
 */
export default function createPlaceholderCommand(description) {
    assertNonEmptyString(description, 'createPlaceholderCommand() requires a description');

    return class PlaceholderCommand {

        static description = description;

        static available = false;

        #commandName;

        constructor(args) {
            const { commandName } = args ?? {};
            this.#commandName = commandName;
        }

        run() {
            const subject = this.#commandName ? `The "${ this.#commandName }" command` : 'This command';
            throw new CommandNotAvailableError(`${ subject } is not available in this version of kixx-dev.`);
        }
    };
}
