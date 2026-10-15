import process from 'node:process';
import { isUndefined } from '../../lib/vendor/kixx-assert/mod.js';

import promptAdminCredentials from '../../lib/admin/prompt-admin-credentials.js';
import resolveAdminEnvironment from '../../lib/admin/resolve-admin-environment.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

export default class AdminCreatePublishingTokenCommand {

    static description = `
        Mint a bearer token for the Publishing API, authenticating as an
        existing admin
    `;

    static options = {
        environment: { type: 'string', short: 'e', description: 'Required application environment' },
        origin: { type: 'string', description: 'Override the configured Admin API origin' },
        roles: { type: 'string', multiple: true, description: 'Publishing role ids, defaults to editor' },
        ttl: { type: 'string', description: 'Time to live in seconds, defaults to 2592000' },
        description: { type: 'string', description: 'Operator-facing description for the minted token' },
    };

    #args;

    constructor(args) {
        this.#args = args ?? {};
    }

    async run(options) {
        const ttl = parseTtl(options?.ttl);

        const target = resolveAdminEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            origin: options?.origin,
            createClient: this.#args.createClient,
        });

        const credentials = await promptAdminCredentials({ promptForValue: this.#args.promptForValue });

        const token = await target.connect(credentials).createPublishingApiToken({
            roles: options?.roles,
            ttl,
            description: options?.description,
        });

        (this.#args.output ?? process.stdout).write(renderToken(token, target.environment));
        return 0;
    }
}

function parseTtl(value) {
    if (isUndefined(value)) {
        return undefined;
    }

    if (!/^[1-9][0-9]*$/.test(value)) {
        throw new UsageError('The --ttl option must be a positive whole number of seconds');
    }

    return Number.parseInt(value, 10);
}

function renderToken(token, environment) {
    const lines = [
        'Publishing API token created. This value is shown once and cannot be retrieved again:',
        '',
        `  ${ token.token }`,
        '',
        `Store it as app.environments.${ environment }.publishingToken in .kixx/secrets.json.`,
        `Roles: ${ token.roles.join(', ') }`,
        `Description: ${ token.description ?? '(none)' }`,
        `Expires: ${ token.tokenExpirationDate }`,
        '',
    ];

    return wrapText(lines.join('\n'));
}
