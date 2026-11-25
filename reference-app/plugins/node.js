// The legacy map: the v6 Node.js adapter packages that are not yet plugins.
// Nothing loads this file. Generated registries wire core and every plugin
// that has a manifest.
//
// Delete an entry when its package becomes a plugin with a manifest, and
// delete this file when the map is empty.
import * as nodeDocumentStoreEngine from './node-document-store-engine/plugin.js';
import * as nodeObjectStore from './node-object-store/plugin.js';
import * as nodeJobQueue from './node-job-queue/plugin.js';

export const plugins = new Map([
    [ 'nodeDocumentStoreEngine', nodeDocumentStoreEngine ],
    [ 'nodeObjectStore', nodeObjectStore ],
    [ 'nodeJobQueue', nodeJobQueue ],
]);
