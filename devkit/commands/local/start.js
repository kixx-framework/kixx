import process from 'node:process';
import { canConnect as defaultCanConnect } from '../../lib/devserver/app-process.js';
import defaultRunDevServer from '../../lib/devserver/run-dev-server.js';
import {
    NAME_POSITIONAL,
    TARGET_OPTION,
    createLocalLog,
    formatCollisionWarning,
    formatLocalCommand,
    listEnvNames,
} from '../../lib/local/command-support.js';
import { readInstance, resolveInstancesDirectory } from '../../lib/local/instance-store.js';
import UsageError from '../../lib/usage-error.js';


export default class LocalStartCommand {

    static description = `
        Run a local instance under the devserver on its own port. The app
        server restarts after code changes; republish content with kixx local
        publish.
    `;

    static positionals = [ NAME_POSITIONAL ];

    static options = {
        target: TARGET_OPTION,
    };

    #projectDirectory;
    #output;
    #stdout;
    #stderr;
    #signals;
    #env;
    #canConnect;
    #runDevServer;
    #fileSystem;
    #createDevServer;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            stdout = process.stdout,
            stderr = process.stderr,
            signals = process,
            env = process.env,
            canConnect = defaultCanConnect,
            runDevServer = defaultRunDevServer,
            fileSystem,
            createDevServer,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#signals = signals;
        this.#env = env;
        this.#canConnect = canConnect;
        this.#runDevServer = runDevServer;
        this.#fileSystem = fileSystem;
        this.#createDevServer = createDevServer;
    }

    async run(options, positionals) {
        const { name } = positionals ?? {};
        const target = options?.target;
        const log = createLocalLog(this.#output);

        const instance = await readInstance({
            instancesDirectory: resolveInstancesDirectory({ sourceDirectory: this.#projectDirectory, target }),
            name,
        });

        const warning = formatCollisionWarning(listEnvNames(instance), this.#env);

        if (warning) {
            log(warning);
        }

        if (await this.#canConnect(instance.port)) {
            throw new UsageError(`Local instance "${ name }" is already running on port ${ instance.port }.`);
        }

        if (!instance.isSeeded) {
            const seedCommand = formatLocalCommand({ command: `seed ${ name }`, projectDirectory: this.#projectDirectory, target });
            log(`Local instance "${ name }" is not seeded; run ${ seedCommand } for an admin login and published content.`);
        }

        return await this.#runDevServer({
            projectDirectory: this.#projectDirectory,
            port: instance.port,
            environment: 'local',
            dotenv: instance.paths.dotenv,
            label: 'kixx local',
            missingServerHint: 'Pass the application directory the instance was created from.',
            output: this.#output,
            stdout: this.#stdout,
            stderr: this.#stderr,
            signals: this.#signals,
            fileSystem: this.#fileSystem,
            createDevServer: this.#createDevServer,
        });
    }
}
