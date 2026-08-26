import authenticateAdminApiRequest from '../app/presentation/middleware/authenticate-admin-api-request.js';
import authorize from '../app/presentation/middleware/authorize.js';
import * as AdminAPI from '../app/presentation/request-handlers/admin-api/mod.js';


export default [
    {
        pattern: '/migrations',
        name: 'migrations',
        inboundMiddleware: [
            authenticateAdminApiRequest,
        ],
        routes: [
            {
                pattern: '{/}',
                name: 'list',
                targets: [
                    {
                        name: 'get',
                        methods: [ 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:list',
                                    resource: 'urn:kixx:admin:migrations',
                                },
                            ]),
                            AdminAPI.listMigrations,
                        ],
                    },
                ],
            },
            {
                pattern: '/:id/run',
                name: 'run',
                targets: [
                    {
                        name: 'post',
                        methods: [ 'POST' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:run',
                                    resource: 'urn:kixx:admin:migrations',
                                },
                            ]),
                            AdminAPI.runMigration,
                        ],
                    },
                ],
            },
        ],
    },
    {
        pattern: '/users/invite{/}',
        name: 'accept-invite',
        targets: [
            {
                name: 'post',
                methods: [ 'POST' ],
                requestHandlers: [
                    AdminAPI.acceptAdminInvite,
                ],
            },
        ],
    },
    {
        pattern: '/publishing-api-tokens{/}',
        name: 'publishing-api-tokens',
        inboundMiddleware: [
            authenticateAdminApiRequest,
        ],
        targets: [
            {
                name: 'create',
                methods: [ 'POST' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:create',
                            resource: 'urn:kixx:admin:api-tokens:publishing',
                        },
                    ]),
                    AdminAPI.createPublishingApiToken,
                ],
            },
        ],
    },
];
