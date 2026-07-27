/**
 * Target-head authorization gates for the admin panel and admin API.
 *
 * Each export is a middleware function built by requirePermission(), gating one
 * resource/action pair against the authenticated user's derived permissions.
 * Every gate here is a fixed decision — none depends on route params or the
 * request body — so they are declared once and shared by every route that needs
 * them, which is what keeps one capability from being spelled two ways.
 *
 * @module admin-authorization
 * @see import('./require-permission.js').requirePermission for the gate's behavior and thrown errors.
 */

import { requirePermission } from './require-permission.js';


export const requireAdminUserInvitesRead = requirePermission({
    action: 'urn:kixx:admin:admin-user-invites:read',
    resource: 'urn:kixx:admin:admin-user-invites',
});

export const requireAdminUserInvitesWrite = requirePermission({
    action: 'urn:kixx:admin:admin-user-invites:write',
    resource: 'urn:kixx:admin:admin-user-invites',
});

export const requirePublishingApiTokensRead = requirePermission({
    action: 'urn:kixx:admin:publishing-api-tokens:read',
    resource: 'urn:kixx:admin:publishing-api-tokens',
});

export const requirePublishingApiTokensWrite = requirePermission({
    action: 'urn:kixx:admin:publishing-api-tokens:write',
    resource: 'urn:kixx:admin:publishing-api-tokens',
});

export const requireMigrationsRead = requirePermission({
    action: 'urn:kixx:admin:migrations:read',
    resource: 'urn:kixx:admin:migrations',
});

export const requireMigrationsWrite = requirePermission({
    action: 'urn:kixx:admin:migrations:write',
    resource: 'urn:kixx:admin:migrations',
});
