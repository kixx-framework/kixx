import authorize from '../app/presentation/middleware/authorize.js';
import HyperviewPageHandler from '../app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import * as AdminPanel from '../app/presentation/request-handlers/admin-panel/mod.js';


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
                    AdminPanel.postRevokeAdminInvite,
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
                    AdminPanel.getAdminInvites,
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
                    AdminPanel.postCreateAdminInvite,
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
                    AdminPanel.postRevokePublishingApiToken,
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
                    AdminPanel.getPublishingApiTokens,
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
                    AdminPanel.postCreatePublishingApiToken,
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
