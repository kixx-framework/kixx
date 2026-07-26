import * as PublishingAPI from '../app/presentation/request-handlers/publishing-api/mod.js';
import {
    requireAssetPermission,
    requireIncludePermission,
    requirePageMetadataPermission,
    requireTemplatePermission,
} from '../app/presentation/request-handlers/publishing-api/authorization.js';


export default [
    {
        pattern: '/templates/base/*filepath',
        name: 'base-templates',
        targets: [
            {
                name: 'put',
                methods: [ 'PUT' ],
                requestHandlers: [
                    requireTemplatePermission,
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
                    requireTemplatePermission,
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
                    requireTemplatePermission,
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
                    requirePageMetadataPermission,
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
                    requireIncludePermission,
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
                    requireAssetPermission,
                    PublishingAPI.putStaticAsset,
                ],
            },
        ],
    },
];
