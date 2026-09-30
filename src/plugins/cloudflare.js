import * as cloudflareContentStore from './cloudflare-content-store/plugin.js';
import * as cloudflareDocumentStoreEngine from './cloudflare-document-store-engine/plugin.js';
import * as cloudflareKeyValueStore from './cloudflare-key-value-store/plugin.js';
import * as cloudflareObjectStore from './cloudflare-object-store/plugin.js';
import * as cloudflareEmailSender from './cloudflare-email-sender/plugin.js';

export const plugins = new Map([
    [ 'cloudflareContentStore', cloudflareContentStore ],
    [ 'cloudflareDocumentStoreEngine', cloudflareDocumentStoreEngine ],
    [ 'cloudflareKeyValueStore', cloudflareKeyValueStore ],
    [ 'cloudflareObjectStore', cloudflareObjectStore ],
    [ 'cloudflareEmailSender', cloudflareEmailSender ],
]);

export const durableObjects = {
    ContentAddressableIndexStore: cloudflareContentStore.ContentAddressableIndexStore,
};
