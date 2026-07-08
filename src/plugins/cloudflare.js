import * as cloudflareDocumentStoreEngine from './cloudflare-document-store-engine/plugin.js';
import * as cloudflareHyperviewPageDataStore from './cloudflare-hyperview-page-data-store/plugin.js';
import * as cloudflareHyperviewTemplateFileStore from './cloudflare-hyperview-template-file-store/plugin.js';
import * as cloudflareKeyValueStore from './cloudflare-key-value-store/plugin.js';
import * as cloudflareObjectStore from './cloudflare-object-store/plugin.js';
import * as cloudflareStaticFileServer from './cloudflare-static-file-server/plugin.js';

const cloudflarePlugins = new Map([
    [ 'cloudflareDocumentStoreEngine', cloudflareDocumentStoreEngine ],
    [ 'cloudflareHyperviewPageDataStore', cloudflareHyperviewPageDataStore ],
    [ 'cloudflareHyperviewTemplateFileStore', cloudflareHyperviewTemplateFileStore ],
    [ 'cloudflareKeyValueStore', cloudflareKeyValueStore ],
    [ 'cloudflareObjectStore', cloudflareObjectStore ],
    [ 'cloudflareStaticFileServer', cloudflareStaticFileServer ],
]);

export default cloudflarePlugins;
