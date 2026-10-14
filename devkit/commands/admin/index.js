import GenSecretTokenCommand from './gen-secure-token.js';
import AdminAcceptInviteCommand from './accept-invite.js';
import AdminCreatePublishingTokenCommand from './create-publishing-token.js';
import AdminListMigrationsCommand from './list-migrations.js';
import AdminRunMigrationCommand from './run-migration.js';


export const description = 'Application administration tools';

export const subcommands = {
    'gen-secure-token': GenSecretTokenCommand,
    'accept-invite': AdminAcceptInviteCommand,
    'create-publishing-token': AdminCreatePublishingTokenCommand,
    'list-migrations': AdminListMigrationsCommand,
    'run-migration': AdminRunMigrationCommand,
};
