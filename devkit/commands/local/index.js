import LocalCreateCommand from './create.js';
import LocalDestroyCommand from './destroy.js';
import LocalListCommand from './list.js';


export const description = 'Throwaway local instances of the app';

export const subcommands = {
    create: LocalCreateCommand,
    list: LocalListCommand,
    destroy: LocalDestroyCommand,
};
