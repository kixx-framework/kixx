import {
    StatResource,
    PutResource,
    CommitChanges,
} from '../app/presentation/request-handlers/publishing-api/mod.js';

export default [
    {
        pattern: '/template-partials',
        name: 'template-partials',
        routes: [
        ],
    },
    {
        pattern: '/base-templates',
        name: 'base-templates',
        routes: [
        ],
    },
    {
        // Optional wildcard group so the root page ('/') can be accessed via
        // `/publishing-api/v1/page-metadata/`
        // A bare `/page-metadata/*pathname` requires at least one path segment, so
        // the root request would fall through.
        pattern: '/page-metadata{/*path}',
        name: 'page-metadata',
        routes: [
        ],
    },
    {
        pattern: '/page-partials/*path',
        name: 'page-partials',
        routes: [
        ],
    },
    {
        pattern: '/page-includes/*path',
        name: 'page-includes',
        routes: [
        ],
    },
    {
        pattern: '/page-templates/*path',
        name: 'page-templates',
        routes: [
        ],
    },
    {
        pattern: '/stats',
        name: 'stats',
        routes: [
        ],
    },
    {
        pattern: '/resources',
        name: 'stats',
        routes: [
        ],
    },
    {
        pattern: '/templates/base/*filepath',
        name: 'base-templates',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requireTemplatePermission,
                    PublishingAPI.putBaseTemplate,
                ],
            },
        ],
    },
    {
        pattern: '/templates/pages/*filepath',
        name: 'page-templates',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requireTemplatePermission,
                    PublishingAPI.putPageTemplate,
                ],
            },
        ],
    },
    {
        pattern: '/templates/partials/*filepath',
        name: 'partial-templates',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requireTemplatePermission,
                    PublishingAPI.putPartialTemplate,
                ],
            },
        ],
    },
    {
        // Optional wildcard group so the site root page ('/') can be
        // published via `PUT /publishing-api/v1/pages` (or with a
        // trailing slash). A bare `/pages/*pathname` requires at least
        // one segment, so the root request would fall through to the
        // catch-all GET/HEAD route and return 405.
        pattern: '/pages{/*pathname}',
        name: 'pages',
        targets: [
            {
                name: 'put-metadata',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requirePageMetadataPermission,
                    PublishingAPI.putPageMetadata,
                ],
            },
        ],
    },
    {
        pattern: '/includes/*filepath',
        name: 'includes',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requireIncludePermission,
                    PublishingAPI.putPageInclude,
                ],
            },
        ],
    },
    {
        pattern: '/assets/*filepath',
        name: 'assets',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    Permissions.requireAssetPermission,
                    PublishingAPI.putStaticAsset,
                ],
            },
        ],
    },
];
