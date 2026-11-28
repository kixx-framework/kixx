import DevStartCommand from './dev/start.js';
import GenerateCommand from './generate.js';
import LocalCreateCommand from './local/create.js';
import LocalDestroyCommand from './local/destroy.js';
import LocalListCommand from './local/list.js';
import LocalStartCommand from './local/start.js';


/**
 * The first word of every two-word command name, with the one-line
 * description that help prints for the group.
 * @type {Object<string, string>}
 */
export const groups = Object.freeze({
    dev: 'Local development tools',
    local: 'Throwaway local instances of the app',
});

// Command name to command class, in the order help lists them. Static imports,
// rather than reading this directory, keep every command in the module graph
// when the CLI is loaded from a registry URL or compiled into one executable.
export default Object.freeze({
    'generate': GenerateCommand,
    'dev start': DevStartCommand,
    'local create': LocalCreateCommand,
    'local start': LocalStartCommand,
    'local list': LocalListCommand,
    'local destroy': LocalDestroyCommand,
});
