import process from 'node:process';

import promptAdminCredentials from '../../lib/admin/prompt-admin-credentials.js';
import resolveAdminEnvironment from '../../lib/admin/resolve-admin-environment.js';
import { wrapText } from '../../lib/text-wrap.js';

export default class AdminListMigrationsCommand {

    static description = `
        List every registered migration with its durable status
    `;

    static options = {
        environment: { type: 'string', short: 'e', description: 'Required application environment' },
        origin: { type: 'string', description: 'Override the configured Admin API origin' },
    };

    #args;

    constructor(args) {
        this.#args = args ?? {};
    }

    async run(options) {
        const target = resolveAdminEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            origin: options?.origin,
            createClient: this.#args.createClient,
        });

        const credentials = await promptAdminCredentials({ promptForValue: this.#args.promptForValue });
        const migrations = await target.connect(credentials).listMigrations();

        (this.#args.output ?? process.stdout).write(wrapText(renderMigrations(migrations)));
        return 0;
    }
}

function renderMigrations(migrations) {
    if (migrations.length === 0) {
        return 'No migrations are registered.\n';
    }

    const lines = migrations.map((migration) => {
        const line = `${ migration.id }  ${ migration.status }  ${ migration.description }`;

        if (migration.status === 'failed' && migration.error) {
            return `${ line }\n  error: ${ migration.error }`;
        }

        return line;
    });

    return `${ lines.join('\n') }\n`;
}
