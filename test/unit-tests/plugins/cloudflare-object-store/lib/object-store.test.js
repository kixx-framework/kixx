import { describe } from 'kixx-test';
import { TransformStream, WritableStream } from 'node:stream/web';
import { assert, assertEqual } from 'kixx-assert';
import ObjectStore from '../../../../../src/plugins/cloudflare-object-store/lib/object-store.js';
import Logger from '../../../../../src/kixx/logger/logger.js';
import objectStoreConformance from '../../../kixx/object-store/object-store-conformance.js';

const UNDERFLOW_MESSAGE = 'FixedLengthStream did not see all expected bytes before close().';
const OVERFLOW_MESSAGE = 'Attempt to write too many bytes through a FixedLengthStream.';

function makeR2(options) {
    const { putError } = options ?? {};
    const objects = new Map();
    return {
        async put(key, body, options) {
            if (putError) {
                throw putError;
            }

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

async function makeStore(options) {
    const r2 = makeR2(options);
    return {
        store: new ObjectStore({ logger: new Logger({ name: 'Test', level: 'NONE' }) }),
        context: {
            config: { env: { OBJECT_STORE: { buckets: { files: { bindingName: 'FILES' } } } } },
            env: { FILES: r2 },
        },
        async close() {},
    };
}

function installPassThroughFixedLengthStream() {
    globalThis.FixedLengthStream = class FixedLengthStream {
        constructor() {
            const stream = new TransformStream();
            this.readable = stream.readable;
            this.writable = stream.writable;
        }
    };
}

function installSeparatedFixedLengthStream(producerError) {
    globalThis.FixedLengthStream = class FixedLengthStream {
        constructor() {
            this.readable = new ReadableStream({
                start(controller) {
                    controller.close();
                },
            });
            this.writable = new WritableStream({
                close() {
                    if (producerError) {
                        throw producerError;
                    }
                },
            });
        }
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function assertLengthMismatch(args) {
    const { producerError, storageError } = args;
    installSeparatedFixedLengthStream(producerError);

    const subject = await makeStore({ putError: storageError });
    const error = await catchAsyncError(() => {
        const body = new Blob([ 'abc' ]).stream();
        return subject.store.put(subject.context, 'files', 'mismatch', body, { contentLength: 2 });
    });
    const nativeError = producerError ?? storageError;

    assert(error);
    assertEqual('OperationalError', error.name);
    assertEqual('ObjectContentLengthMismatch', error.code);
    assertEqual(nativeError, error.cause);
    assertEqual(null, await subject.store.head(subject.context, 'files', 'mismatch'));
    await subject.close();
    installPassThroughFixedLengthStream();
}

describe('Cloudflare ObjectStore', ({ describe, before, after, it }) => {
    before(installPassThroughFixedLengthStream);
    after(() => {
        delete globalThis.FixedLengthStream;
    });

    objectStoreConformance(describe, makeStore);

    describe('FixedLengthStream failures', ({ it }) => {
        it('normalizes a producer-side underflow', async () => {
            await assertLengthMismatch({
                producerError: new TypeError(UNDERFLOW_MESSAGE),
                storageError: new Error('R2 stream aborted'),
            });
        });

        it('normalizes a producer-side overflow', async () => {
            await assertLengthMismatch({
                producerError: new TypeError(OVERFLOW_MESSAGE),
                storageError: new Error('R2 stream aborted'),
            });
        });

        it('normalizes a consumer-side underflow', async () => {
            await assertLengthMismatch({
                storageError: new TypeError(UNDERFLOW_MESSAGE),
            });
        });

        it('normalizes a consumer-side overflow', async () => {
            await assertLengthMismatch({
                storageError: new TypeError(OVERFLOW_MESSAGE),
            });
        });

        it('keeps an unrelated R2 TypeError generic', async () => {
            const nativeError = new TypeError('R2 unavailable');
            installSeparatedFixedLengthStream();

            const subject = await makeStore({ putError: nativeError });
            const error = await catchAsyncError(() => {
                const body = new Blob([ 'abc' ]).stream();
                return subject.store.put(subject.context, 'files', 'failed', body, { contentLength: 3 });
            });

            assert(error);
            assertEqual('OperationalError', error.name);
            assertEqual('OPERATIONAL_ERROR', error.code);
            assertEqual(nativeError, error.cause);
            assertEqual(null, await subject.store.head(subject.context, 'files', 'failed'));
            await subject.close();
            installPassThroughFixedLengthStream();
        });
    });

    it('keeps an unrelated producer failure generic', async () => {
        const nativeError = new TypeError('Request body failed');
        installSeparatedFixedLengthStream(nativeError);

        const subject = await makeStore({ putError: new Error('R2 stream aborted') });
        const error = await catchAsyncError(() => {
            const body = new Blob([ 'abc' ]).stream();
            return subject.store.put(subject.context, 'files', 'failed', body, { contentLength: 3 });
        });

        assert(error);
        assertEqual('OperationalError', error.name);
        assertEqual('OPERATIONAL_ERROR', error.code);
        assertEqual(nativeError, error.cause);
        assertEqual(null, await subject.store.head(subject.context, 'files', 'failed'));
        await subject.close();
        installPassThroughFixedLengthStream();
    });
});
