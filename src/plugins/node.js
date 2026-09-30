import * as nodeDocumentStoreEngine from './node-document-store-engine/plugin.js';
import * as nodeContentStore from './node-content-store/plugin.js';
import * as nodeKeyValueStore from './node-key-value-store/plugin.js';
import * as nodeObjectStore from './node-object-store/plugin.js';
import * as nodeJobQueue from './node-job-queue/plugin.js';
import * as nodeEmailSender from './node-email-sender/plugin.js';

export const plugins = new Map([
    [ 'nodeDocumentStoreEngine', nodeDocumentStoreEngine ],
    [ 'nodeContentStore', nodeContentStore ],
    [ 'nodeKeyValueStore', nodeKeyValueStore ],
    [ 'nodeObjectStore', nodeObjectStore ],
    [ 'nodeJobQueue', nodeJobQueue ],
    [ 'nodeEmailSender', nodeEmailSender ],
]);
