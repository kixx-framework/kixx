import {
    InvalidInviteError,
    InviteSpentInEmailRaceError,
    NewUserConflictError,
} from './admin-api-error.js';
import UsageError from '../usage-error.js';

// Matches the server's NewAdminUserForm password schema.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;


/**
 * Redeems an admin invite or bootstrap token and creates the admin account.
 * @param {Object} args
 * @param {Object} args.client - Admin API client with `acceptInvite()`
 * @param {string} args.inviteToken - Invite or bootstrap token
 * @param {string} args.emailAddress - New admin email address
 * @param {string} args.password - New admin password, 12 to 256 characters
 * @returns {Promise<Object>} The created account
 * @throws {UsageError} For a bad password length or a rejected invite
 */
export default async function acceptInvite(args) {
    const { client, inviteToken, emailAddress, password } = args ?? {};

    // A 422 would not consume the invite either, but there is no reason
    // to make the operator discover the rule by failing remotely.
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        throw new UsageError(
            `New admin password must be ${ MIN_PASSWORD_LENGTH } to ${ MAX_PASSWORD_LENGTH } characters`,
        );
    }

    try {
        return await client.acceptInvite(inviteToken, { emailAddress, password });
    } catch (error) {
        if (error instanceof InvalidInviteError) {
            throw new UsageError('The invite token is unknown, expired, revoked, or already used.');
        }
        if (error instanceof NewUserConflictError) {
            throw new UsageError(
                `An admin account already exists for ${ emailAddress }. `
                + 'The invite was not used; retry with a different email address.',
            );
        }
        if (error instanceof InviteSpentInEmailRaceError) {
            throw new UsageError(
                `A concurrent signup claimed ${ emailAddress } and the invite was consumed. `
                + 'A new invite is required.',
            );
        }
        throw error;
    }
}
