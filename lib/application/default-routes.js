import StaticFileServer from '../request-handlers/static-file-server.js';
import PageHandler from '../request-handlers/page-handler.js';
import ErrorHandler from '../error-handlers/error-handler.js';


export default [
    {
        name: 'DefaultPages',
        pattern: '*',
        errorHandlers: [
            // eslint-disable-next-line new-cap
            ErrorHandler({}),
        ],
        targets: [
            {
                name: 'PageHandler',
                methods: [ 'GET', 'HEAD' ],
                handlers: [
                    // eslint-disable-next-line new-cap
                    StaticFileServer({}),
                    // eslint-disable-next-line new-cap
                    PageHandler({}),
                ],
            },
        ],
    },
];
