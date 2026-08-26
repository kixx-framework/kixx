import authorize from '../app/presentation/middleware/authorize.js';
import HyperviewPageHandler from '../app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import * as AdminInvites from '../app/presentation/request-handlers/admin-panel/admin-invites.js';
import * as AdminPublishingApiTokens from '../app/presentation/request-handlers/admin-panel/admin-publishing-api-tokens.js';


export default [
    {
        pattern: '/style-guide{.:suffix}',
        name: 'style-guide',
        targets: [
            {
                name: 'render-style-guide-page',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
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
                    authorize([
                        {
                            action: 'urn:kixx:revoke',
                            resource: 'urn:kixx:admin:user-invites',
                        },
                    ]),
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
                    authorize([
                        {
                            action: 'urn:kixx:list',
                            resource: 'urn:kixx:admin:user-invites',
                        },
                    ]),
                    AdminInvites.getAdminInvites,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
                ],
            },
            {
                name: 'create-invite',
                methods: [ 'POST' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:create',
                            resource: 'urn:kixx:admin:user-invites',
                        },
                    ]),
                    AdminInvites.postCreateAdminInvite,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
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
                    authorize([
                        {
                            action: 'urn:kixx:revoke',
                            resource: 'urn:kixx:admin:api-tokens:publishing',
                        },
                    ]),
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
                    authorize([
                        {
                            action: 'urn:kixx:list',
                            resource: 'urn:kixx:admin:api-tokens:publishing',
                        },
                    ]),
                    AdminPublishingApiTokens.getPublishingApiTokens,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
                ],
            },
            {
                name: 'create-token',
                methods: [ 'POST' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:create',
                            resource: 'urn:kixx:admin:api-tokens:publishing',
                        },
                    ]),
                    AdminPublishingApiTokens.postCreatePublishingApiToken,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
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
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
                ],
            },
        ],
    },
];
