import authorize from '../app/presentation/middleware/authorize.js';
import HyperviewPageHandler from '../app/presentation/request-handlers/hyperview/hyperview-page-handler.js';
import * as AdminPanel from '../app/presentation/request-handlers/admin-panel/mod.js';
import { getAdminFileDownload } from '../app/presentation/request-handlers/files/mod.js';
import fileUploadErrorHandler from '../app/presentation/error-handlers/file-upload-error-handler.js';
import fileActionErrorHandler from '../app/presentation/error-handlers/file-action-error-handler.js';

const FILE_RESOURCE = 'urn:kixx:publishing:files';
const fileDecision = (action) => [ { action: `urn:kixx:${ action }`, resource: FILE_RESOURCE } ];


export default [
    {
        pattern: '/files/new',
        name: 'new-files',
        targets: [
            {
                name: 'render-new',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize(fileDecision('create')),
                    AdminPanel.getNewFiles,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
                ],
            },
        ],
    },
    {
        pattern: '/files/upload',
        name: 'file-upload',
        targets: [
            {
                name: 'upload',
                methods: [ 'POST' ],
                errorHandlers: [ fileUploadErrorHandler ],
                requestHandlers: [ authorize(fileDecision('create')), AdminPanel.postFileUpload ],
            },
        ],
    },
    ...fileActionRoutes(),
    {
        pattern: '/files/:fileId/download',
        name: 'file-download',
        targets: [
            {
                name: 'download',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [ authorize(fileDecision('get')), getAdminFileDownload ],
            },
        ],
    },
    {
        pattern: '/files/:fileId',
        name: 'file-detail',
        targets: [
            {
                name: 'render-detail',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize(fileDecision('get')),
                    AdminPanel.getAdminFile,
                    HyperviewPageHandler({
                        baseTemplateId: 'admin.html',
                        pathname: '/admin/files/detail',
                        usePageCache: false,
                    }),
                ],
            },
        ],
    },
    {
        pattern: '/files',
        name: 'files',
        targets: [
            {
                name: 'render-list',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize(fileDecision('list')),
                    AdminPanel.getAdminFiles,
                    HyperviewPageHandler({ baseTemplateId: 'admin.html', usePageCache: false }),
                ],
            },
        ],
    },
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
        pattern: '/publishing/builds/:buildId',
        name: 'publishing-build',
        targets: [
            {
                name: 'render-build',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:builds',
                        },
                    ]),
                    AdminPanel.getPublishingBuild,
                    HyperviewPageHandler({
                        baseTemplateId: 'admin.html',
                        pathname: '/admin/publishing/builds',
                    }),
                ],
            },
        ],
    },
    {
        pattern: '/publishing/releases/:releaseId',
        name: 'publishing-release',
        targets: [
            {
                name: 'render-release',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:releases',
                        },
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:builds',
                        },
                    ]),
                    AdminPanel.getPublishingRelease,
                    // Every render mints a fresh, session-bound CSRF token for the
                    // assign-to-running-build control, so the rendered page cache
                    // must never store or serve it.
                    HyperviewPageHandler({
                        baseTemplateId: 'admin.html',
                        pathname: '/admin/publishing/releases',
                        usePageCache: false,
                    }),
                ],
            },
        ],
    },
    {
        // Its own route because it renders no page of its own (only redirects)
        // and is reachable from two pages (overview and Release detail).
        pattern: '/publishing/assign',
        name: 'publishing-assign',
        targets: [
            {
                name: 'assign',
                methods: [ 'POST' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:update',
                            resource: 'urn:kixx:publishing:builds',
                        },
                    ]),
                    AdminPanel.postAssignRelease,
                ],
            },
        ],
    },
    {
        pattern: '/publishing',
        name: 'publishing',
        targets: [
            {
                name: 'render-overview',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [
                    authorize([
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:releases',
                        },
                        {
                            action: 'urn:kixx:get',
                            resource: 'urn:kixx:publishing:builds',
                        },
                    ]),
                    AdminPanel.getPublishingOverview,
                    // Every render mints a fresh, session-bound CSRF token for the
                    // assign-to-running-build control, so the rendered page cache
                    // must never store or serve it.
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

function fileActionRoutes() {
    const actions = [
        [ 'metadata', 'update', AdminPanel.postFileMetadata, fileActionErrorHandler ],
        [ 'replace', 'update', AdminPanel.postFileReplacement, fileUploadErrorHandler ],
        [ 'publish', 'update', AdminPanel.postFilePublish, fileActionErrorHandler ],
        [ 'unpublish', 'update', AdminPanel.postFileUnpublish, fileActionErrorHandler ],
        [ 'delete', 'delete', AdminPanel.postFileDelete, fileActionErrorHandler ],
    ];
    return actions.map(([ name, permission, handler, errorHandler ]) => ({
        pattern: `/files/:fileId/${ name }`,
        name: `file-${ name }`,
        targets: [ {
            name,
            methods: [ 'POST' ],
            errorHandlers: errorHandler ? [ errorHandler ] : undefined,
            requestHandlers: [ authorize(fileDecision(permission)), handler ],
        } ],
    }));
}
