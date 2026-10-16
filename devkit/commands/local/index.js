import LocalCreateCommand from './create.js';
import LocalDestroyCommand from './destroy.js';
import LocalListCommand from './list.js';
import LocalSeedCommand from './seed.js';


export const description = 'Throwaway local instances of the app';

export const subcommands = {
    create: LocalCreateCommand,
    seed: LocalSeedCommand,
    list: LocalListCommand,
    destroy: LocalDestroyCommand,
};
