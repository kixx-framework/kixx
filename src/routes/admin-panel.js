import { HyperviewStaticPageHandler, HyperviewDynamicPageHandler } from '../kixx/hyperview/hyperview-request-handlers.js';
import * as AdminInvites from '../app/presentation/request-handlers/admin-invites.js';
import * as AdminPublishingApiTokens from '../app/presentation/request-handlers/admin-publishing-api-tokens.js';
import {
    requireAdminUserInvitesRead,
    requireAdminUserInvitesWrite,
    requirePublishingApiTokensRead,
    requirePublishingApiTokensWrite,
} from '../app/presentation/request-handlers/admin-authorization.js';


export default [
    {
        pattern: '/style-guide{.:suffix}',
        name: 'style-guide',
        targets: [
            {
                name: 'render-style-guide-page',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    HyperviewStaticPageHandler(),
                ],
            },
        ],
    },
    {
        // Revoke is its own route because it shares the POST method
        // with create-invite; one route cannot host two POST targets.
        pattern: '/invites/revoke',
        name: 'invites-revoke',
        targets: [
            {
                name: 'revoke',
                methods: [ 'POST' ],
                requestHandlers: [
                    requireAdminUserInvitesWrite,
                    AdminInvites.postRevokeAdminInvite,
                ],
            },
        ],
    },
    {
        pattern: '/invites',
        name: 'invites',
        targets: [
            {
                name: 'render-invite-list',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    requireAdminUserInvitesRead,
                    AdminInvites.getAdminInvites,
                    HyperviewDynamicPageHandler(),
                ],
            },
            {
                name: 'create-invite',
                methods: [ 'POST' ],
                requestHandlers: [
                    requireAdminUserInvitesWrite,
                    AdminInvites.postCreateAdminInvite,
                    HyperviewDynamicPageHandler(),
                ],
            },
        ],
    },
    {
        // Revoke is its own route because it shares the POST method
        // with create-token; one route cannot host two POST targets.
        pattern: '/publishing-api-tokens/revoke',
        name: 'publishing-api-tokens-revoke',
        targets: [
            {
                name: 'revoke',
                methods: [ 'POST' ],
                requestHandlers: [
                    requirePublishingApiTokensWrite,
                    AdminPublishingApiTokens.postRevokePublishingApiToken,
                ],
            },
        ],
    },
    {
        pattern: '/publishing-api-tokens',
        name: 'publishing-api-tokens',
        targets: [
            {
                name: 'render-token-list',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    requirePublishingApiTokensRead,
                    AdminPublishingApiTokens.getPublishingApiTokens,
                    HyperviewDynamicPageHandler(),
                ],
            },
            {
                name: 'create-token',
                methods: [ 'POST' ],
                requestHandlers: [
                    requirePublishingApiTokensWrite,
                    AdminPublishingApiTokens.postCreatePublishingApiToken,
                    HyperviewDynamicPageHandler(),
                ],
            },
        ],
    },
    {
        pattern: '*',
        name: 'static-pages',
        targets: [
            {
                name: 'render-static-page',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    HyperviewStaticPageHandler(),
                ],
            },
        ],
    },
];
