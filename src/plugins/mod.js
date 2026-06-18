import * as hyperview from './hyperview/plugin.js';
import * as cloudflareDocumentStoreEngine from './cloudflare-document-store-engine/plugin.js';
import * as cloudflareHyperviewPageDataStore from './cloudflare-hyperview-page-data-store/plugin.js';
import * as cloudflareHyperviewTemplateFileStore from './cloudflare-hyperview-template-file-store/plugin.js';
import * as cloudflareKeyValueStore from './cloudflare-key-value-store/plugin.js';
import * as nodeDocumentStoreEngine from './node-document-store-engine/plugin.js';
import * as nodeHyperviewPageDataStore from './node-hyperview-page-data-store/plugin.js';
import * as nodeHyperviewTemplateFileStore from './node-hyperview-template-file-store/plugin.js';
import * as nodeKeyValueStore from './node-key-value-store/plugin.js';


export const generalPlugins = new Map([
    [ 'hyperview', hyperview ],
]);

export const cloudflarePlugins = new Map([
    [ 'cloudflareDocumentStoreEngine', cloudflareDocumentStoreEngine ],
    [ 'cloudflareHyperviewPageDataStore', cloudflareHyperviewPageDataStore ],
    [ 'cloudflareHyperviewTemplateFileStore', cloudflareHyperviewTemplateFileStore ],
    [ 'cloudflareKeyValueStore', cloudflareKeyValueStore ],
]);

export const nodePlugins = new Map([
    [ 'nodeDocumentStoreEngine', nodeDocumentStoreEngine ],
    [ 'nodeHyperviewPageDataStore', nodeHyperviewPageDataStore ],
    [ 'nodeHyperviewTemplateFileStore', nodeHyperviewTemplateFileStore ],
    [ 'nodeKeyValueStore', nodeKeyValueStore ],
]);
