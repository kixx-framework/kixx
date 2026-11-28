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

    // The project's own parser reads its example.env.secrets.
    static requiresTooling = true;

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
    #cwd;
    #tooling;
    #output;
    #now;
    #getFreePort;
    #env;

    constructor(args) {
        const {
            projectDirectory,
            cwd = process.cwd(),
            tooling,
            output = process.stdout,
            now,
            getFreePort = defaultGetFreePort,
            env = process.env,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#cwd = cwd;
        this.#tooling = tooling;
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
                cwd: this.#cwd,
                target: options?.target,
            }),
            name,
            port,
            parseSecretsManifest: this.#tooling.tooling.parseSecretsManifest,
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
            command: `start ${ name }`,
            cwd: this.#cwd,
            projectDirectory: this.#projectDirectory,
            target: options?.target,
        }) }`);

        // The instance also holds generated secrets and the names of its
        // dotenv variables. Neither belongs in a command's data.
        return {
            name,
            port: instance.port,
            buildId: instance.buildId,
            directory: instance.directory,
        };
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
