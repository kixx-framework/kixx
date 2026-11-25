import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { hashBlob } from '../../../kixx/content-addressable-store/addressing.js';
import ServerResponse from '../../../kixx/http-router/server-response.js';
import { getObjectStatus, putObject } from '../../../kixx/publishing-api/objects.js';
import { MAX_OBJECT_BYTES } from '../../../kixx/publishing-api/constants.js';
import { ServiceUnavailableError } from '../../../kixx/errors/mod.js';
import {
    catchError,
    makeHarness,
    makeJsonRequest,
    readDocument,
    removeHarnesses,
    uploadText,
} from './publishing-api-harness.js';


function makeRawRequest(objectId, bytes, headers = { 'content-length': String(bytes.byteLength) }) {
    const request = {
        pathnameParams: { objectId },
        headers: new Headers(headers),
        readCount: 0,
        async arrayBuffer() {
            request.readCount += 1;
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
    };
    return request;
}

function statusRequest(objectIds, options = {}) {
    return makeJsonRequest({ type: 'ObjectStatus', attributes: { objectIds }, ...options });
}

const HELLO = new TextEncoder().encode('hello');


describe('Publishing API objects', ({ after, describe }) => {

    after(removeHarnesses);

    describe('PUT /objects/:objectId', ({ it }) => {

        it('stores new bytes as 201, and the same bytes again as 200', async () => {
            const { context, service } = await makeHarness();
            const objectId = await hashBlob(HELLO.buffer);

            const created = await putObject(context, makeRawRequest(objectId, HELLO), new ServerResponse());
            const again = await putObject(context, makeRawRequest(objectId, HELLO), new ServerResponse());

            assertEqual(201, created.status);
            assertEqual(200, again.status);
            assertEqual('{"type":"Object","id":"' + objectId + '","attributes":{"size":5}}', JSON.stringify(readDocument(created).data));
            assertEqual(5, (await service.statObjects(context, [ objectId ]))[0].size);
        });

        it('rejects an invalid object id before reading the body', async () => {
            const { context } = await makeHarness();
            const request = makeRawRequest('not-a-hash', HELLO);

            const error = await catchError(() => putObject(context, request, new ServerResponse()));

            assertEqual(422, error.httpStatusCode);
            assertEqual('ObjectIdInvalid', error.code);
            assertEqual(0, request.readCount);
        });

        it('rejects missing Content-Length before reading the body', async () => {
            const { context } = await makeHarness();
            const request = makeRawRequest(await hashBlob(HELLO.buffer), HELLO, {});

            const error = await catchError(() => putObject(context, request, new ServerResponse()));

            assertEqual(411, error.httpStatusCode);
            assertEqual('LengthRequired', error.code);
            assertEqual(0, request.readCount);
        });

        it('rejects a Content-Length that is not a decimal integer', async () => {
            const { context } = await makeHarness();
            const objectId = await hashBlob(HELLO.buffer);

            for (const length of [ '', '-1', '5.0', '0x5', 'five' ]) {
                const request = makeRawRequest(objectId, HELLO, { 'content-length': length });
                const error = await catchError(() => putObject(context, request, new ServerResponse()));

                assertEqual(400, error.httpStatusCode, length);
                assertEqual(0, request.readCount);
            }
        });

        it('rejects an oversized Content-Length before reading the body', async () => {
            const { context } = await makeHarness();
            const request = makeRawRequest(await hashBlob(HELLO.buffer), HELLO, {
                'content-length': String(MAX_OBJECT_BYTES + 1),
            });

            const error = await catchError(() => putObject(context, request, new ServerResponse()));

            assertEqual(413, error.httpStatusCode);
            assertEqual(0, request.readCount);
        });

        it('rejects a body over the limit even when Content-Length understates it (PERF-1)', async () => {
            const { context, service } = await makeHarness();
            const objectId = await hashBlob(HELLO.buffer);
            const request = makeRawRequest(objectId, new Uint8Array(new ArrayBuffer(MAX_OBJECT_BYTES + 1)), {
                'content-length': '5',
            });

            const error = await catchError(() => putObject(context, request, new ServerResponse()));

            assertEqual(413, error.httpStatusCode);
            assertEqual(1, request.readCount);
            assertEqual(null, (await service.statObjects(context, [ objectId ]))[0]);
        });

        it('rejects mismatched bytes without storing them', async () => {
            const { context, service } = await makeHarness();
            const objectId = await hashBlob(new TextEncoder().encode('expected').buffer);

            const error = await catchError(() => putObject(context, makeRawRequest(objectId, HELLO), new ServerResponse()));

            assertEqual(422, error.httpStatusCode);
            assertEqual('ObjectIdMismatch', error.code);
            assertEqual(null, (await service.statObjects(context, [ objectId ]))[0]);
        });

        it('propagates an overloaded store from statObjects without storing', async () => {
            // The real store can't be made to fail this way, so this one case uses a double.
            const objectId = await hashBlob(HELLO.buffer);
            const overloadError = new ServiceUnavailableError('busy', {
                code: 'ContentStoreOverloaded',
                retryAfterSeconds: 5,
            });
            let writeCount = 0;
            const context = {
                getService() {
                    return {
                        statObjects: async () => {
                            throw overloadError;
                        },
                        putObject: async () => {
                            writeCount += 1;
                        },
                    };
                },
            };

            const error = await catchError(() => putObject(context, makeRawRequest(objectId, HELLO), new ServerResponse()));

            assertEqual(overloadError, error);
            assertEqual(503, error.httpStatusCode);
            assertEqual(5, error.retryAfterSeconds);
            assertEqual(0, writeCount);
        });

        it('uploads without any build being assigned', async () => {
            const { context, service } = await makeHarness();
            const objectId = await hashBlob(HELLO.buffer);

            const response = await putObject(context, makeRawRequest(objectId, HELLO), new ServerResponse());

            assertEqual(201, response.status);
            assertEqual(0, (await service.listBuilds(context)).length);
        });
    });

    describe('POST /objects/status', ({ it }) => {

        it('deduplicates ids and returns only stored objects', async () => {
            const { context, service } = await makeHarness();
            const stored = await uploadText(context, service, 'stored');
            const missing = await hashBlob(new TextEncoder().encode('missing').buffer);

            const response = await getObjectStatus(
                context,
                statusRequest([ stored.objectId, stored.objectId, missing ]),
                new ServerResponse(),
            );
            const { data } = readDocument(response);

            assertEqual(200, response.status);
            assertEqual(1, data.length);
            assertEqual(stored.objectId, data[0].id);
            assertEqual('Object', data[0].type);
            assertEqual(6, data[0].attributes.size);
        });

        it('accepts 100 distinct ids and rejects 101 (PERF-1)', async () => {
            const { context } = await makeHarness();
            const ids = await Promise.all(Array.from({ length: 101 }, (_, index) => {
                return hashBlob(new TextEncoder().encode(String(index)).buffer);
            }));

            const response = await getObjectStatus(context, statusRequest(ids.slice(0, 100)), new ServerResponse());
            assertEqual(0, readDocument(response).data.length);

            const error = await catchError(() => getObjectStatus(context, statusRequest(ids), new ServerResponse()));
            assertEqual(400, error.httpStatusCode);
        });

        it('counts ids after deduplication', async () => {
            const { context } = await makeHarness();
            const objectId = await hashBlob(HELLO.buffer);

            const response = await getObjectStatus(context, statusRequest(Array(150).fill(objectId)), new ServerResponse());

            assertEqual(200, response.status);
        });

        it('rejects ids that are not an array, or not hashes', async () => {
            const { context } = await makeHarness();

            const notArray = await catchError(() => getObjectStatus(context, statusRequest('abc'), new ServerResponse()));
            const notHash = await catchError(() => getObjectStatus(context, statusRequest([ 'abc' ]), new ServerResponse()));

            assertEqual(400, notArray.httpStatusCode);
            assertEqual(422, notHash.httpStatusCode);
            assertEqual('ObjectIdInvalid', notHash.code);
            assertEqual('attributes.objectIds', notHash.errors[0].source);
        });

        it('rejects a body that is not JSON:API', async () => {
            const { context } = await makeHarness();

            const wrongType = await catchError(() => getObjectStatus(
                context,
                statusRequest([], { contentType: 'application/json' }),
                new ServerResponse(),
            ));
            const noData = await catchError(() => getObjectStatus(
                context,
                makeJsonRequest({ document: { objectIds: [] } }),
                new ServerResponse(),
            ));
            const mismatch = await catchError(() => getObjectStatus(
                context,
                makeJsonRequest({ type: 'Release', attributes: { objectIds: [] } }),
                new ServerResponse(),
            ));
            const noAttributes = await catchError(() => getObjectStatus(
                context,
                makeJsonRequest({ document: { data: { type: 'ObjectStatus', attributes: [] } } }),
                new ServerResponse(),
            ));

            assertEqual(415, wrongType.httpStatusCode);
            assertEqual(400, noData.httpStatusCode);
            assertEqual(409, mismatch.httpStatusCode);
            assertEqual('JsonApiResourceTypeMismatch', mismatch.code);
            assertEqual(400, noAttributes.httpStatusCode);
            assert(noAttributes.message.includes('attributes'));
        });
    });
});
