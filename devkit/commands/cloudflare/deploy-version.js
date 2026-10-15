import process from 'node:process';
import CloudflareAPIClient from '../../lib/cloudflare/cloudflare-api-client.js';
import { deployWorkerVersion } from '../../lib/cloudflare/deploy-worker-version.js';
import { wrapText } from '../../lib/text-wrap.js';


export default class CloudflareDeployVersionCommand {

    static description = 'Route all traffic to an existing Worker version';

    static options = {
        environment: {
            type: 'string',
            short: 'e',
            description: 'Required environment whose Worker version will be deployed',
        },
        'version-id': {
            type: 'string',
            description: 'Version to deploy; defaults to the version recorded in .kixx/cloudflare-state.<env>.json',
        },
    };

    static requiredSecrets = [
        'cloudflare.accountId',
        'cloudflare.apiToken',
    ];

    #projectDirectory;
    #cloudflareConfig;
    #secrets;
    #fileSystem;
    #output;
    #createClient;

    constructor(args) {
        const {
            projectDirectory,
            cloudflareConfig,
            secrets,
            fileSystem,
            output = process.stdout,
            createClient = (options) => new CloudflareAPIClient(options),
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#cloudflareConfig = cloudflareConfig;
        this.#secrets = secrets;
        this.#fileSystem = fileSystem;
        this.#output = output;
        this.#createClient = createClient;
    }

    async run(options) {
        const result = await deployWorkerVersion({
            projectDirectory: this.#projectDirectory,
            environment: options?.environment,
            cloudflareConfig: this.#cloudflareConfig,
            apiClient: this.#createClient(this.#secrets.cloudflare),
            versionId: options?.['version-id'],
            fileSystem: this.#fileSystem,
        });

        const lines = [
            `Environment: ${ result.environment }`,
            `Worker:      ${ result.workerName }`,
            `Version:     ${ result.versionId }`,
            `BUILD_ID:    ${ result.buildId ?? '(none)' }`,
            '',
            'Deployed to 100% of traffic.',
        ];

        if (result.stateFilepath) {
            lines.push(`Updated ${ result.stateFilepath }`);
        }

        lines.push('');

        this.#output.write(wrapText(lines.join('\n')));

        return 0;
    }
}
