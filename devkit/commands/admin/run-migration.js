import process from 'node:process';
import { isNonEmptyString, isUndefined } from '../../lib/vendor/kixx-assert/mod.js';

import promptAdminCredentials from '../../lib/admin/prompt-admin-credentials.js';
import resolveAdminEnvironment from '../../lib/admin/resolve-admin-environment.js';
import {
    MigrationAlreadyAppliedError,
    MigrationCursorConflictError,
    MigrationConcurrencyError,
} from '../../lib/admin/admin-api-error.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

export default class AdminRunMigrationCommand {

    static description = `
        Run one bounded batch of a migration, in dry-run or real mode
    `;

    static options = {
        migration: { type: 'string', short: 'm', description: 'Required permanent migration id from list-migrations' },
        environment: { type: 'string', short: 'e', description: 'Required application environment' },
        origin: { type: 'string', description: 'Override the configured Admin API origin' },
        'dry-run': { type: 'boolean', description: 'Preview one batch without mutating anything' },
        force: { type: 'boolean', description: 'Restart an applied or failed real run from the beginning' },
        cursor: { type: 'string', description: 'Dry-run cursor from a prior batch' },
    };

    #args;

    constructor(args) {
        this.#args = args ?? {};
    }

    async run(options) {
        const id = options?.migration;

        if (!isNonEmptyString(id)) {
            throw new UsageError('The --migration option is required');
        }

        const dryRun = options?.['dry-run'] ?? false;
        const force = options?.force ?? false;
        const cursor = options?.cursor;

        if (dryRun && force) {
            throw new UsageError('Pass at most one of --dry-run or --force');
        }
        if (!isUndefined(cursor) && !dryRun) {
            throw new UsageError('--cursor is only meaningful together with --dry-run');
        }

        const output = this.#args.output ?? process.stdout;

        const target = resolveAdminEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            origin: options?.origin,
            createClient: this.#args.createClient,
        });

        const credentials = await promptAdminCredentials({ promptForValue: this.#args.promptForValue });
        const client = target.connect(credentials);

        if (!dryRun) {
            // Informational only: names the target of a ledger-mutating
            // request so a stale --environment is visible in the transcript.
            output.write(wrapText(`Running on ${ target.environment } (${ target.origin })\n`));
        }

        const result = await runBatch(client, id, { dryRun, force, cursor });

        output.write(renderResult(id, target.environment, result));
        return 0;
    }
}

async function runBatch(client, migrationId, options) {
    try {
        return await client.runMigration(migrationId, options);
    } catch (error) {
        if (error instanceof MigrationAlreadyAppliedError) {
            throw new UsageError(
                `Migration "${ migrationId }" is already applied. Pass --force to rerun it deliberately.`,
            );
        }
        if (error instanceof MigrationCursorConflictError) {
            throw new UsageError(
                `Migration "${ migrationId }" has an invalid stored cursor and is now failed. `
                + 'Restart it with --force.',
            );
        }
        if (error instanceof MigrationConcurrencyError) {
            throw new UsageError(
                `Another operator advanced migration "${ migrationId }" first. `
                + 'Run list-migrations and retry without --force.',
            );
        }
        throw error;
    }
}

// The Next: command is left unwrapped so it can be copied and run whole.
function renderResult(migrationId, environment, result) {
    const { done, status, stats, cursor, dryRun } = result;

    const lines = [
        `done: ${ done }`,
        `status: ${ status }`,
        `stats: ${ JSON.stringify(stats) }`,
        `cursor: ${ cursor }`,
    ];

    let text = `${ wrapText(lines.join('\n')) }\n`;

    if (!done) {
        const next = dryRun
            ? `kixx admin run-migration -e ${ environment } -m ${ migrationId } --dry-run --cursor ${ cursor }`
            : `kixx admin run-migration -e ${ environment } -m ${ migrationId }`;
        text += `\nNext: ${ next }\n`;
    }

    return text;
}
