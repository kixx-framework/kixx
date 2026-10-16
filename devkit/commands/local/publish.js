import process from 'node:process';
import { canConnect as defaultCanConnect } from '../../lib/devserver/app-process.js';
import {
    NAME_POSITIONAL,
    TARGET_OPTION,
    formatLocalCommand,
} from '../../lib/local/command-support.js';
import { readCredentials, readInstance, resolveInstancesDirectory } from '../../lib/local/instance-store.js';
import defaultPublishRelease from '../../lib/publishing/publish-release.js';
import PublishingAPIClient from '../../lib/publishing/publishing-api-client.js';
import { renderPublishResult } from '../../lib/publishing/render-publish-result.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';


export default class LocalPublishCommand {

    static description = `
        Publish the app's content to a running, seeded local instance and
        assign it to the instance's Build ID
    `;

    static positionals = [ NAME_POSITIONAL ];

    static options = {
        target: TARGET_OPTION,
        'dry-run': { type: 'boolean', description: 'Preview the server-backed object diff without writes' },
        verbose: { type: 'boolean', description: 'List every resource and disposition' },
    };

    #projectDirectory;
    #output;
    #canConnect;
    #createPublishingClient;
    #publishRelease;
    #fileSystem;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            canConnect = defaultCanConnect,
            createPublishingClient = (options) => new PublishingAPIClient(options),
            publishRelease = defaultPublishRelease,
            fileSystem,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#canConnect = canConnect;
        this.#createPublishingClient = createPublishingClient;
        this.#publishRelease = publishRelease;
        this.#fileSystem = fileSystem;
    }

    async run(options, positionals) {
        const { name } = positionals ?? {};
        const target = options?.target;

        const formatCommand = (command) => formatLocalCommand({
            command,
            projectDirectory: this.#projectDirectory,
            target,
        });

        const instance = await readInstance({
            instancesDirectory: resolveInstancesDirectory({ sourceDirectory: this.#projectDirectory, target }),
            name,
        });

        const credentials = await readCredentials(instance.paths);

        if (credentials === null) {
            throw new UsageError(`Local instance "${ name }" is not seeded; run ${ formatCommand(`seed ${ name }`) } first.`);
        }

        if (!await this.#canConnect(instance.port)) {
            throw new UsageError(
                `Local instance "${ name }" is not running on port ${ instance.port }; ` +
                `start it with ${ formatCommand(`start ${ name }`) }.`,
            );
        }

        const origin = credentials.baseUrl;

        const result = await this.#publishRelease({
            client: this.#createPublishingClient({ origin, token: credentials.publishingApiToken }),
            projectDirectory: this.#projectDirectory,
            buildId: credentials.buildId,
            dryRun: options?.['dry-run'] ?? false,
            fileSystem: this.#fileSystem,
            formatRecovery: () => `Recover with: ${ formatCommand(`publish ${ name }`) }`,
        });

        this.#output.write(wrapText(renderPublishResult({
            result,
            environment: 'local',
            origin,
            verbose: options?.verbose ?? false,
        })));

        return 0;
    }
}
