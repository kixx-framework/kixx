import * as nodeDocumentStoreEngine from './node-document-store-engine/plugin.js';
import * as nodeHyperviewPageDataStore from './node-hyperview-page-data-store/plugin.js';
import * as nodeHyperviewTemplateFileStore from './node-hyperview-template-file-store/plugin.js';
import * as nodeKeyValueStore from './node-key-value-store/plugin.js';
import * as nodeObjectStore from './node-object-store/plugin.js';
import * as nodeStaticFileServer from './node-static-file-server/plugin.js';

const nodePlugins = new Map([
    [ 'nodeDocumentStoreEngine', nodeDocumentStoreEngine ],
    [ 'nodeHyperviewPageDataStore', nodeHyperviewPageDataStore ],
    [ 'nodeHyperviewTemplateFileStore', nodeHyperviewTemplateFileStore ],
    [ 'nodeKeyValueStore', nodeKeyValueStore ],
    [ 'nodeObjectStore', nodeObjectStore ],
    [ 'nodeStaticFileServer', nodeStaticFileServer ],
]);

export default nodePlugins;
