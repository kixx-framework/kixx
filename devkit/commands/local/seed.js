import process from 'node:process';
import {
    NAME_POSITIONAL,
    TARGET_OPTION,
    createLocalLog,
    formatCollisionWarning,
    formatLocalCommand,
    listEnvNames,
} from '../../lib/local/command-support.js';
import { readInstance, resolveInstancesDirectory } from '../../lib/local/instance-store.js';
import seedInstance from '../../lib/local/seed-instance.js';


export default class LocalSeedCommand {

    static description = `
        Boot a local instance once to create its root admin, mint a Publishing
        API token, publish the app's content, and save credentials.json
    `;

    static positionals = [ NAME_POSITIONAL ];

    static options = {
        target: TARGET_OPTION,
        verbose: {
            type: 'boolean',
            description: 'Stream the app server output',
        },
    };

    #projectDirectory;
    #output;
    #stdout;
    #stderr;
    #env;
    #seedArgs;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            stdout = process.stdout,
            stderr = process.stderr,
            env = process.env,
            ...seedArgs
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#env = env;
        this.#seedArgs = seedArgs;
    }

    async run(options, positionals) {
        const { name } = positionals ?? {};
        const target = options?.target;
        const verbose = options?.verbose ?? false;
        const log = createLocalLog(this.#output);

        const formatCommand = (command) => formatLocalCommand({
            command,
            projectDirectory: this.#projectDirectory,
            target,
        });

        const instancesDirectory = resolveInstancesDirectory({ sourceDirectory: this.#projectDirectory, target });

        // Read here too, so the warning shows before the server is booted.
        const instance = await readInstance({ instancesDirectory, name });
        const warning = formatCollisionWarning(listEnvNames(instance), this.#env);

        if (warning) {
            log(warning);
        }

        const { credentials, credentialsPath, publishResult } = await seedInstance({
            createAppProcess: this.#seedArgs.createAppProcess,
            createAdminClient: this.#seedArgs.createAdminClient,
            createPublishingClient: this.#seedArgs.createPublishingClient,
            canConnect: this.#seedArgs.canConnect,
            acceptInvite: this.#seedArgs.acceptInvite,
            publishRelease: this.#seedArgs.publishRelease,
            generatePassword: this.#seedArgs.generatePassword,
            fileSystem: this.#seedArgs.fileSystem,
            sourceDirectory: this.#projectDirectory,
            instancesDirectory,
            name,
            log,
            stdout: verbose ? this.#stdout : undefined,
            stderr: verbose ? this.#stderr : undefined,
            formatCommand,
        });

        log(`Seeded local instance "${ name }"`);
        log(`Base URL:    ${ credentials.baseUrl }`);
        log(`Username:    ${ credentials.username }`);
        log(`Build ID:    ${ credentials.buildId }`);
        log(`Release:     ${ publishResult.releaseId }`);
        log(`Credentials: ${ credentialsPath }`);
        log('credentials.json is plain text; do not commit or share it.');
        log(`Next: ${ formatCommand(`start ${ name }`) }`);

        return 0;
    }
}
