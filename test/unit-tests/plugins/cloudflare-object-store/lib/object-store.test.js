import { describe } from 'kixx-test';
import { TransformStream } from 'node:stream/web';
import ObjectStore from '../../../../../src/plugins/cloudflare-object-store/lib/object-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import objectStoreConformance from '../../../kixx/object-store/object-store-conformance.js';

function makeR2() {
    const objects = new Map();
    return {
        async put(key, body, options) {
            const bytes = body instanceof ReadableStream
                ? new Uint8Array(await new Response(body).arrayBuffer())
                : new Uint8Array(await new Blob([ body ]).arrayBuffer());
            const object = {
                key,
                size: bytes.byteLength,
                etag: `etag-${ bytes.byteLength }`,
                uploaded: new Date(),
                httpMetadata: options.httpMetadata,
                customMetadata: options.customMetadata,
            };
            objects.set(key, object);
            return object;
        },
        async head(key) {
            return objects.get(key) ?? null;
        },
    };
}

async function makeStore() {
    const r2 = makeR2();
    return {
        store: new ObjectStore({ logger: new Logger({ name: 'Test', level: 'NONE' }) }),
        context: {
            config: { env: { OBJECT_STORE: { buckets: { files: { bindingName: 'FILES' } } } } },
            env: { FILES: r2 },
        },
        async close() {},
    };
}

describe('Cloudflare ObjectStore', ({ describe, before, after }) => {
    before(() => {
        globalThis.FixedLengthStream = class FixedLengthStream {
            constructor() {
                const stream = new TransformStream();
                this.readable = stream.readable;
                this.writable = stream.writable;
            }
        };
    });
    after(() => {
        delete globalThis.FixedLengthStream;
    });

    objectStoreConformance(describe, makeStore);
});
