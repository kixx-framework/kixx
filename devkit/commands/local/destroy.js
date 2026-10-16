import process from 'node:process';
import { canConnect as defaultCanConnect } from '../../lib/devserver/app-process.js';
import { NAME_POSITIONAL, TARGET_OPTION, createLocalLog } from '../../lib/local/command-support.js';
import { destroyInstance, resolveInstancesDirectory } from '../../lib/local/instance-store.js';


export default class LocalDestroyCommand {

    static description = 'Delete a stopped local instance and all of its data';

    static positionals = [ NAME_POSITIONAL ];

    static options = {
        target: TARGET_OPTION,
    };

    #projectDirectory;
    #output;
    #canConnect;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            canConnect = defaultCanConnect,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#canConnect = canConnect;
    }

    async run(options, positionals) {
        const { name } = positionals ?? {};

        await destroyInstance({
            instancesDirectory: resolveInstancesDirectory({
                sourceDirectory: this.#projectDirectory,
                target: options?.target,
            }),
            name,
            canConnect: this.#canConnect,
        });

        createLocalLog(this.#output)(`Destroyed local instance "${ name }"`);

        return 0;
    }
}
