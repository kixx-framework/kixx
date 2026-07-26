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
