import * as AdminDataApi from '../app/presentation/request-handlers/admin-data-api/mod.js';


// Resource routes accept every method the router knows. The handlers map a
// method to a registered operation after authentication, so an unsupported
// method gets a 405 whose Allow header reflects the current registration.
const ALL_METHODS = [ 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE' ];

// WARNING: The route and target names below are referenced by
// RESOURCE_TARGET_NAME and COLLECTION_TARGET_NAME in
// app/presentation/request-handlers/admin-data-api/protocol.js.
export default [
    {
        pattern: '{/}',
        name: 'discovery',
        targets: [
            {
                name: 'get',
                methods: [ 'GET' ],
                requestHandlers: [ AdminDataApi.getDiscovery ],
            },
        ],
    },
    {
        pattern: '/:type{/}',
        name: 'collection',
        targets: [
            {
                name: 'dispatch',
                methods: ALL_METHODS,
                requestHandlers: [ AdminDataApi.handleCollectionRequest ],
            },
        ],
    },
    {
        pattern: '/:type/:id{/}',
        name: 'resource',
        targets: [
            {
                name: 'dispatch',
                methods: ALL_METHODS,
                requestHandlers: [ AdminDataApi.handleResourceRequest ],
            },
        ],
    },
];
