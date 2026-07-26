import { authenticateAdminApiRequest } from '../app/presentation/middleware/admin-api-authentication.js';
import * as AdminAPI from '../app/presentation/request-handlers/admin-api/mod.js';
import {
    requireMigrationsRead,
    requireMigrationsWrite,
    requirePublishingApiTokensWrite,
} from '../app/presentation/request-handlers/admin-authorization.js';


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
                            requireMigrationsRead,
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
                            requireMigrationsWrite,
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
                    requirePublishingApiTokensWrite,
                    AdminAPI.createPublishingApiToken,
                ],
            },
        ],
    },
];
