import { requirePermission } from '../middleware/require-permission.js';


/**
 * Builds a requirePermission() instance for one admin capability/verb pair.
 * Grant actions use the `urn:kixx:admin:<kind>:<verb>` / resource
 * `urn:kixx:admin:<kind>` shape shared by every admin role grant (spec §11.2).
 * Uses ForbiddenError's class defaults for code/message — the admin surface
 * has no preserved 403 wire contract, unlike publishing.
 * @param {string} kind - Admin resource kind, e.g. 'admin-user-invites'.
 * @param {string} verb - Action verb, e.g. 'read' or 'write'.
 * @returns {Function} Named `(context, request, response)` middleware enforcing the decision.
 */
function adminGate(kind, verb) {
    return requirePermission({
        action: `urn:kixx:admin:${ kind }:${ verb }`,
        resource: `urn:kixx:admin:${ kind }`,
    });
}


// Shared verbatim by the cookie-auth admin panel and the Basic-auth admin API
// (spec §11.2) — one instance per capability/verb pair.
export const requireAdminUserInvitesRead = adminGate('admin-user-invites', 'read');
export const requireAdminUserInvitesWrite = adminGate('admin-user-invites', 'write');
export const requirePublishingApiTokensRead = adminGate('publishing-api-tokens', 'read');
export const requirePublishingApiTokensWrite = adminGate('publishing-api-tokens', 'write');
export const requireMigrationsRead = adminGate('migrations', 'read');
export const requireMigrationsWrite = adminGate('migrations', 'write');
