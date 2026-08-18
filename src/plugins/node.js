import * as nodeDocumentStoreEngine from './node-document-store-engine/plugin.js';
import * as nodeKeyValueStore from './node-key-value-store/plugin.js';
import * as nodeObjectStore from './node-object-store/plugin.js';
import * as nodeStaticFileServer from './node-static-file-server/plugin.js';

export const plugins = new Map([
    [ 'nodeDocumentStoreEngine', nodeDocumentStoreEngine ],
    [ 'nodeKeyValueStore', nodeKeyValueStore ],
    [ 'nodeObjectStore', nodeObjectStore ],
    [ 'nodeStaticFileServer', nodeStaticFileServer ],
]);
