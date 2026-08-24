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
                        requestHandlers: [ commitChanges ],
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
                        requestHandlers: [ statStaticAsset ],
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
                        requestHandlers: [ statGlobalTemplatePartials ],
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
                        requestHandlers: [ statBaseTemplates ],
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
                        requestHandlers: [ statPageMetadata ],
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
                        requestHandlers: [ statPagePartials ],
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
                        requestHandlers: [ statPageIncludes ],
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
                        requestHandlers: [ statPageTemplate ],
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
                        requestHandlers: [ statEmailAssets ],
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
                        requestHandlers: [ putStaticAsset ],
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
                        requestHandlers: [ putGlobalTemplatePartials ],
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
                        requestHandlers: [ putBaseTemplates ],
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
                        requestHandlers: [ putPageMetadata ],
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
                        requestHandlers: [ putPagePartials ],
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
                        requestHandlers: [ putPageIncludes ],
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
                        requestHandlers: [ putPageTemplate ],
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
                        requestHandlers: [ putEmailAssets ],
                    },
                ],
            },
        ],
    },
];
