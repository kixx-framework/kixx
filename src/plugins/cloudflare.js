import * as cloudflareContentAddressableStore from './cloudflare-content-addressable-store/plugin.js';
import * as cloudflareDocumentStoreEngine from './cloudflare-document-store-engine/plugin.js';
import * as cloudflareKeyValueStore from './cloudflare-key-value-store/plugin.js';
import * as cloudflareObjectStore from './cloudflare-object-store/plugin.js';
import * as cloudflareStaticFileServer from './cloudflare-static-file-server/plugin.js';

export const plugins = new Map([
    [ 'cloudflareDocumentStoreEngine', cloudflareDocumentStoreEngine ],
    [ 'cloudflareContentAddressableStore', cloudflareContentAddressableStore ],
    [ 'cloudflareKeyValueStore', cloudflareKeyValueStore ],
    [ 'cloudflareObjectStore', cloudflareObjectStore ],
    [ 'cloudflareStaticFileServer', cloudflareStaticFileServer ],
]);

export const durableObjects = {
    ContentAddressableIndexStore: cloudflareContentAddressableStore.ContentAddressableIndexStore,
};
