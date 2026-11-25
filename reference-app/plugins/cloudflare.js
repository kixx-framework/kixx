// The legacy map: the v6 Cloudflare adapter packages that are not yet
// plugins. Nothing loads this file. Generated registries wire core and every
// plugin that has a manifest.
//
// Delete an entry when its package becomes a plugin with a manifest, and
// delete this file when the map is empty.
import * as cloudflareDocumentStoreEngine from './cloudflare-document-store-engine/plugin.js';
import * as cloudflareJobQueue from './cloudflare-job-queue/plugin.js';
import * as cloudflareObjectStore from './cloudflare-object-store/plugin.js';

export const plugins = new Map([
    [ 'cloudflareDocumentStoreEngine', cloudflareDocumentStoreEngine ],
    [ 'cloudflareJobQueue', cloudflareJobQueue ],
    [ 'cloudflareObjectStore', cloudflareObjectStore ],
]);

export const durableObjects = {
    JobQueueStore: cloudflareJobQueue.JobQueueStore,
};
