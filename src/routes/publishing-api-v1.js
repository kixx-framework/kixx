import {
    StatResource,
    PutResource,
    CommitChanges,
} from '../app/presentation/request-handlers/publishing-api/mod.js';

export default [
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
                            CommitChanges(),
                        ],
                    },
                ],
            },
            {
                pattern: '/template-partials',
                name: 'template-partials',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            StatResource({ type: 'template_partials' }),
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
                            StatResource({ type: 'base_templates' }),
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
                            StatResource({ type: 'page_metadata' }),
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
                            StatResource({ type: 'page_partials' }),
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
                            StatResource({ type: 'page_includes' }),
                        ],
                    },
                ],
            },
            {
                pattern: '/page-templates/*path',
                name: 'page-templates',
                targets: [
                    {
                        name: 'get-stats',
                        methods: [ 'HEAD', 'GET' ],
                        requestHandlers: [
                            StatResource({ type: 'page_templates' }),
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
                pattern: '/template-partials',
                name: 'template-partials',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            PutResource({ type: 'template_partials' }),
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
                            PutResource({ type: 'base_templates' }),
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
                            PutResource({ type: 'page_metadata' }),
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
                            PutResource({ type: 'page_partials' }),
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
                            PutResource({ type: 'page_includes' }),
                        ],
                    },
                ],
            },
            {
                pattern: '/page-templates/*path',
                name: 'page-templates',
                targets: [
                    {
                        name: 'put-resource',
                        methods: [ 'PUT' ],
                        requestHandlers: [
                            PutResource({ type: 'page_templates' }),
                        ],
                    },
                ],
            },
        ],
    },
];
