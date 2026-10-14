/**
 * Looks up commands and sub-commands in a static map of command modules.
 *
 * The map is built from static imports (see `commands/index.js`) rather than
 * by reading the commands directory, so the CLI also works when it is loaded
 * from a remote registry URL, where there is no directory to read.
 */
export default class CommandRegistry {

    #commands;

    /**
     * @param {Object<string, {description: string, subcommands: Object<string, Function>}>} commands - Command
     *   name to command index module; each module maps sub-command names to sub-command classes
     */
    constructor(commands) {
        this.#commands = commands;
    }

    commandExists(commandName) {
        // hasOwn() keeps inherited names like "constructor" from resolving.
        return Object.hasOwn(this.#commands, commandName);
    }

    listCommands() {
        // Stable ordering keeps generated help predictable.
        return Object.keys(this.#commands)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({
                name,
                description: this.#commands[name].description || '',
            }));
    }

    // Sub-commands list in their declaration order in the command's index.js.
    listSubCommands(commandName) {
        const { subcommands } = this.#commands[commandName];

        if (!subcommands) {
            return [];
        }

        return Object.entries(subcommands).map(([ name, Command ]) => ({
            name,
            description: Command.description || '',
        }));
    }

    resolveCommand(commandName, subCommandName) {
        const { subcommands } = this.#commands[commandName];

        if (!subcommands || !Object.hasOwn(subcommands, subCommandName)) {
            return null;
        }

        return subcommands[subCommandName];
    }
}
