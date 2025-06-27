import StaticFileServer from '../request-handlers/handlers/static-file-server.js';
import ObjectStoreReader from '../request-handlers/handlers/object-store-reader.js';
import PageHandler from '../request-handlers/handlers/page-handler.js';
import PageErrorHandler from '../request-handlers/error-handlers/page-error-handler.js';


export default [
    {
        name: 'ObjectStore',
        pattern: '/kixx/objects/:id',
        errorHandlers: [
            // eslint-disable-next-line new-cap
            PageErrorHandler({ viewService: 'kixx.AppViewService' }),
        ],
        targets: [
            {
                name: 'ObjectStoreGET',
                methods: [ 'GET', 'HEAD' ],
                handlers: [
                    // eslint-disable-next-line new-cap
                    ObjectStoreReader(),
                ],
            },
        ],
    },
    {
        name: 'DefaultPages',
        pattern: '*',
        errorHandlers: [
            // eslint-disable-next-line new-cap
            PageErrorHandler({ viewService: 'kixx.AppViewService' }),
        ],
        targets: [
            {
                name: 'PageHandler',
                methods: [ 'GET', 'HEAD' ],
                handlers: [
                    // eslint-disable-next-line new-cap
                    StaticFileServer(),
                    // eslint-disable-next-line new-cap
                    PageHandler({ viewService: 'kixx.AppViewService' }),
                ],
            },
        ],
    },
];
