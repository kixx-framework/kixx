import process from 'node:process';
import { getFreePort as defaultGetFreePort } from '../../lib/devserver/app-process.js';
import {
    NAME_POSITIONAL,
    TARGET_OPTION,
    createLocalLog,
    formatCollisionWarning,
    formatLocalCommand,
} from '../../lib/local/command-support.js';
import { createInstance, resolveInstancesDirectory } from '../../lib/local/instance-store.js';
import UsageError from '../../lib/usage-error.js';


export default class LocalCreateCommand {

    static description = `
        Create a throwaway local instance of the app: a port, a fresh Build ID,
        and generated secrets in <target>/instances/<name>/
    `;

    static positionals = [ NAME_POSITIONAL ];

    static options = {
        target: TARGET_OPTION,
        port: {
            type: 'string',
            short: 'p',
            description: 'Port for the instance; default a free port',
        },
    };

    #projectDirectory;
    #output;
    #now;
    #getFreePort;
    #env;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            now,
            getFreePort = defaultGetFreePort,
            env = process.env,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#now = now;
        this.#getFreePort = getFreePort;
        this.#env = env;
    }

    async run(options, positionals) {
        const { name } = positionals ?? {};
        const port = parsePort(options?.port);

        const instance = await createInstance({
            sourceDirectory: this.#projectDirectory,
            instancesDirectory: resolveInstancesDirectory({
                sourceDirectory: this.#projectDirectory,
                target: options?.target,
            }),
            name,
            port,
            now: this.#now,
            getFreePort: this.#getFreePort,
        });

        const log = createLocalLog(this.#output);

        log(`Created local instance "${ name }"`);
        log(`Port:      ${ instance.port }`);
        log(`Build ID:  ${ instance.buildId }`);
        log(`Directory: ${ instance.directory }`);

        const warning = formatCollisionWarning(instance.envNames, this.#env);

        if (warning) {
            log(warning);
        }

        log(`Next: ${ formatLocalCommand({
            command: `seed ${ name }`,
            projectDirectory: this.#projectDirectory,
            target: options?.target,
        }) }`);

        return 0;
    }
}


function parsePort(value) {
    if (value === undefined) {
        return undefined;
    }

    if (!/^\d+$/.test(value)) {
        throw new UsageError(`The --port value must be an integer from 1 to 65535 (got "${ value }")`);
    }

    return Number.parseInt(value, 10);
}
