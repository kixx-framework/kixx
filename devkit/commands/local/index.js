import LocalCreateCommand from './create.js';
import LocalDestroyCommand from './destroy.js';
import LocalListCommand from './list.js';
import LocalPublishCommand from './publish.js';
import LocalSeedCommand from './seed.js';
import LocalStartCommand from './start.js';


export const description = 'Throwaway local instances of the app';

export const subcommands = {
    create: LocalCreateCommand,
    seed: LocalSeedCommand,
    start: LocalStartCommand,
    publish: LocalPublishCommand,
    list: LocalListCommand,
    destroy: LocalDestroyCommand,
};
