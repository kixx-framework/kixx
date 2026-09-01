import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { hashBlob } from '../../../../../../src/kixx/content-addressable-store/addressing.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { getObjectStatus, putObject } from '../../../../../../src/app/presentation/request-handlers/publishing-api/objects.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';


function makeRawRequest(objectId, bytes) {
    return {
        pathnameParams: { objectId },
        headers: new Headers(),
        body: new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        }),
    };
}

async function catchError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('Publishing API objects', ({ it }) => {

    it('rejects mismatched bytes without storing them', async () => {
        const objectId = await hashBlob(new TextEncoder().encode('expected').buffer);
        let writeCount = 0;
        const context = {
            getService() {
                return {
                    statObjects: async () => [ null ],
                    putObject: async () => {
                        writeCount += 1;
                    },
                };
            },
        };
        const error = await catchError(() => putObject(
            context,
            makeRawRequest(objectId, new TextEncoder().encode('wrong')),
            new ServerResponse(),
        ));

        assert(error);
        assertEqual('ObjectIdMismatch', error.code);
        assertEqual(0, writeCount);
    });

    it('uploads without opening or requiring a build pointer', async () => {
        const bytes = new TextEncoder().encode('hello');
        const objectId = await hashBlob(bytes.buffer);
        let writeCount = 0;
        const context = {
            getService() {
                return {
                    statObjects: async () => [ null ],
                    putObject: async () => {
                        writeCount += 1;
                        return { objectId, size: bytes.byteLength };
                    },
                };
            },
        };
        const response = await putObject(context, makeRawRequest(objectId, bytes), new ServerResponse());

        assertEqual(201, response.status);
        assertEqual(1, writeCount);
    });

    it('deduplicates status ids and returns only stored objects', async () => {
        const objectId = await hashBlob(new TextEncoder().encode('stored').buffer);
        let received;
        const context = {
            getService() {
                return {
                    statObjects: async (_context, objectIds) => {
                        received = objectIds;
                        return [ { size: 5 } ];
                    },
                };
            },
        };
        const request = {
            getContentMediaType: () => JSON_API_CONTENT_TYPE,
            json: async () => ({
                data: { type: 'ObjectStatus', attributes: { objectIds: [ objectId, objectId ] } },
            }),
        };
        const response = await getObjectStatus(context, request, new ServerResponse());
        const document = JSON.parse(response.body);

        assertEqual(1, received.length);
        assertEqual(1, document.data.length);
        assertEqual(5, document.data[0].attributes.size);
    });
});
