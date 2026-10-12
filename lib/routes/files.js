import * as Files from '../app/presentation/request-handlers/files/mod.js';

export default [
    {
        pattern: '/files/:fileId',
        name: 'files',
        targets: [
            {
                name: 'download',
                methods: [ 'GET', 'HEAD' ],
                requestHandlers: [ Files.getPublicFile ],
            },
        ],
    },
];
