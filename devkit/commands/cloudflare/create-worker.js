import process from 'node:process';
import CloudflareAPIClient from '../../lib/cloudflare/cloudflare-api-client.js';
import readWorkerConfig from '../../lib/cloudflare/read-worker-config.js';


export default class CloudflareCreateWorkerCommand {

    static description = 'Create a Worker from the environment\'s WORKER configuration';

    static options = {
        environment: {
            type: 'string',
            short: 'e',
            description: 'Required environment whose WORKER configuration will be created',
        },
    };

    static requiredSecrets = [
        'cloudflare.accountId',
        'cloudflare.apiToken',
    ];

    #cloudflareConfig;
    #secrets;
    #output;
    #createClient;

    constructor(args) {
        const {
            cloudflareConfig,
            secrets,
            output = process.stdout,
            createClient = (options) => new CloudflareAPIClient(options),
        } = args ?? {};

        this.#cloudflareConfig = cloudflareConfig;
        this.#secrets = secrets;
        this.#output = output;
        this.#createClient = createClient;
    }

    async run(options) {
        const workerConfig = readWorkerConfig(this.#cloudflareConfig, options?.environment);
        const client = this.#createClient(this.#secrets.cloudflare);

        const worker = await client.createWorker(workerConfig);

        this.#output.write(`${ JSON.stringify(worker, null, 4) }\n`);

        return 0;
    }
}
