import authorize from '../app/presentation/middleware/authorize.js';
import HyperviewPageHandler from '../app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import * as AdminPanel from '../app/presentation/request-handlers/admin-panel/mod.js';


export default [
    {
        pattern: '{/}',
        name: 'admin-directory',
        targets: [
            {
                name: 'render-admin-directory',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    HyperviewPageHandler({ baseTemplateId: 'admin.html' }),
                ],
            },
        ],
    },
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
                    // Every render mints a fresh, session-bound CSRF token for the
                    // create-invite form, so the rendered page cache must never
                    // store or serve it.
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
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
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
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
                    // Every render mints a fresh, session-bound CSRF token for the
                    // create-token form, so the rendered page cache must never
                    // store or serve it.
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
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
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
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
