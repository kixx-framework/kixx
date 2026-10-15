import process from 'node:process';

import resolveAdminEnvironment from '../../lib/admin/resolve-admin-environment.js';
import {
    InvalidInviteError,
    InviteSpentInEmailRaceError,
    NewUserConflictError,
} from '../../lib/admin/admin-api-error.js';
import {
    promptForValue as defaultPromptForValue,
    promptForValueTwice as defaultPromptForValueTwice,
} from '../../lib/prompt.js';
import { wrapText } from '../../lib/text-wrap.js';
import UsageError from '../../lib/usage-error.js';

// Matches the server's NewAdminUserForm password schema.
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

export default class AdminAcceptInviteCommand {

    static description = `
        Redeem a one-time admin invite or bootstrap token and create the
        admin account it grants
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
        const promptForValue = this.#args.promptForValue ?? defaultPromptForValue;
        const promptForValueTwice = this.#args.promptForValueTwice ?? defaultPromptForValueTwice;

        // Resolved first so a bad --environment fails before any secret is typed.
        const target = resolveAdminEnvironment({
            environment: options?.environment,
            config: this.#args.config,
            origin: options?.origin,
            createClient: this.#args.createClient,
        });

        const inviteToken = await promptForValue({
            envVar: 'KIXX_ADMIN_INVITE_TOKEN',
            label: 'Invite token',
            mask: true,
        });

        const emailAddress = await promptForValue({
            envVar: 'KIXX_ADMIN_EMAIL',
            label: 'New admin email address',
        });

        const password = await promptForValueTwice({
            envVar: 'KIXX_ADMIN_PASSWORD',
            label: 'New admin password',
        });

        // A 422 would not consume the invite either, but there is no reason
        // to make the operator discover the rule by failing remotely.
        if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
            throw new UsageError(
                `New admin password must be ${ MIN_PASSWORD_LENGTH } to ${ MAX_PASSWORD_LENGTH } characters`,
            );
        }

        const account = await acceptInvite(target.connect(), inviteToken, { emailAddress, password });

        (this.#args.output ?? process.stdout).write(wrapText(
            `Created admin account ${ account.adminUserId } <${ account.emailAddress }> `
            + `at ${ account.userCreationDate }\n`,
        ));

        return 0;
    }
}

async function acceptInvite(client, inviteToken, account) {
    try {
        return await client.acceptInvite(inviteToken, account);
    } catch (error) {
        if (error instanceof InvalidInviteError) {
            throw new UsageError('The invite token is unknown, expired, revoked, or already used.');
        }
        if (error instanceof NewUserConflictError) {
            throw new UsageError(
                `An admin account already exists for ${ account.emailAddress }. `
                + 'The invite was not used; retry with a different email address.',
            );
        }
        if (error instanceof InviteSpentInEmailRaceError) {
            throw new UsageError(
                `A concurrent signup claimed ${ account.emailAddress } and the invite was consumed. `
                + 'A new invite is required.',
            );
        }
        throw error;
    }
}
