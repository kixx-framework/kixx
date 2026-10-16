import process from 'node:process';

import acceptInvite from '../../lib/admin/accept-invite.js';
import resolveAdminEnvironment from '../../lib/admin/resolve-admin-environment.js';
import {
    promptForValue as defaultPromptForValue,
    promptForValueTwice as defaultPromptForValueTwice,
} from '../../lib/prompt.js';
import { wrapText } from '../../lib/text-wrap.js';

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

        // Checks the password length before any request is made.
        const account = await acceptInvite({
            client: target.connect(),
            inviteToken,
            emailAddress,
            password,
        });

        (this.#args.output ?? process.stdout).write(wrapText(
            `Created admin account ${ account.adminUserId } <${ account.emailAddress }> `
            + `at ${ account.userCreationDate }\n`,
        ));

        return 0;
    }
}
