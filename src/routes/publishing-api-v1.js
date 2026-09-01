import authorize from '../app/presentation/middleware/authorize.js';
import {
    statStaticAsset,
    statGlobalTemplatePartials,
    statBaseTemplates,
    statPageMetadata,
    statPageIncludes,
    statPagePartials,
    statPageTemplate,
    statEmailAssets,
    putStaticAsset,
    putGlobalTemplatePartials,
    putBaseTemplates,
    putPageMetadata,
    putPageIncludes,
    putPagePartials,
    putPageTemplate,
    putEmailAssets,
    commitChanges,
    getBuild,
    putBuild,
} from '../app/presentation/request-handlers/publishing-api/mod.js';

export default [
    {
        pattern: '/build',
        name: 'build',
        targets: [
            {
                name: 'get-build',
                methods: [ 'GET' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:build',
                        },
                    ]),
                    getBuild,
                ],
            },
            {
                name: 'put-build',
                methods: [ 'PUT' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:update',
                            resource: 'urn:kixx:publishing:build',
                        },
                    ]),
                    putBuild,
                ],
            },
        ],
    },
    {
        pattern: '/index',
        name: 'index',
        routes: [
            {
                pattern: '/closure',
                name: 'closure',
                targets: [
                    {
                        name: 'commit-changes',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:index',
                                },
                            ]),
                            commitChanges,
                        ],
                    },
                ],
            },
            {
                pattern: '/static-asset/*path',
                name: 'static-asset',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:files',
                                },
                            ]),
                            statStaticAsset,
                        ],
                    },
                ],
            },
            {
                pattern: '/global-template-partials',
                name: 'global-template-partials',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:templates',
                                },
                            ]),
                            statGlobalTemplatePartials,
                        ],
                    },
                ],
            },
            {
                pattern: '/base-templates',
                name: 'base-templates',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:templates',
                                },
                            ]),
                            statBaseTemplates,
                        ],
                    },
                ],
            },
            {
                // Optional wildcard group so the root page ('/') can be accessed via
                // `/publishing-api/v1/page-metadata/`.
                // A bare `/page-metadata/*pathname` requires at least one path segment, so
                // the root request would fall through.
                pattern: '/page-metadata{/*path}',
                name: 'page-metadata',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:page',
                                },
                            ]),
                            statPageMetadata,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-partials{/*path}',
                name: 'page-partials',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:page',
                                },
                            ]),
                            statPagePartials,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-includes{/*path}',
                name: 'page-includes',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:page',
                                },
                            ]),
                            statPageIncludes,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-templates/*path',
                name: 'page-template',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:page',
                                },
                            ]),
                            statPageTemplate,
                        ],
                    },
                ],
            },
            {
                pattern: '/emails/*path',
                name: 'email',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:get',
                                    resource: 'urn:kixx:publishing:stats:email',
                                },
                            ]),
                            statEmailAssets,
                        ],
                    },
                ],
            },
        ],
    },
    {
        pattern: '/resources',
        name: 'resources',
        routes: [
            {
                pattern: '/static-asset/*path',
                name: 'static-asset',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:files',
                                },
                            ]),
                            putStaticAsset,
                        ],
                    },
                ],
            },
            {
                pattern: '/global-template-partials',
                name: 'global-template-partials',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:templates',
                                },
                            ]),
                            putGlobalTemplatePartials,
                        ],
                    },
                ],
            },
            {
                pattern: '/base-templates',
                name: 'base-templates',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:templates',
                                },
                            ]),
                            putBaseTemplates,
                        ],
                    },
                ],
            },
            {
                // Optional wildcard group so the root page ('/') can be accessed via
                // `/publishing-api/v1/page-metadata/`.
                // A bare `/page-metadata/*pathname` requires at least one path segment, so
                // the root request would fall through.
                pattern: '/page-metadata{/*path}',
                name: 'page-metadata',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:page',
                                },
                            ]),
                            putPageMetadata,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-partials{/*path}',
                name: 'page-partials',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:page',
                                },
                            ]),
                            putPagePartials,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-includes{/*path}',
                name: 'page-includes',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:page',
                                },
                            ]),
                            putPageIncludes,
                        ],
                    },
                ],
            },
            {
                pattern: '/page-templates/*path',
                name: 'page-template',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:page',
                                },
                            ]),
                            putPageTemplate,
                        ],
                    },
                ],
            },
            {
                pattern: '/emails/*path',
                name: 'emails',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            authorize([
                                {
                                    action: 'urn:kixx:create',
                                    resource: 'urn:kixx:publishing:resources:email',
                                },
                            ]),
                            putEmailAssets,
                        ],
                    },
                ],
            },
        ],
    },
];
