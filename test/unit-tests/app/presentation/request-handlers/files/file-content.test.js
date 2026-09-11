import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import {
    getAdminFileDownload,
    getPublicFile,
} from '../../../../../../src/app/presentation/request-handlers/files/file-content.js';

describe('file content handlers', ({ it }) => {
    it('returns a non-cacheable 404 without reading bytes while unpublished', async () => {
        const context = makeContext(makeFile({ isPublished: false }));
        const response = new ServerResponse();

        await getPublicFile(context, makeRequest(), response);

        assertEqual(404, response.status);
        assertEqual('no-store', response.headers.get('cache-control'));
        assertEqual(0, context.contentReads);
    });

    it('returns a bodyless 304 only after observing published state', async () => {
        const context = makeContext(makeFile());
        const response = new ServerResponse();

        await getPublicFile(context, makeRequest({ ifNoneMatch: 'W/"generation-2"' }), response);

        assertEqual(304, response.status);
        assertEqual(null, response.body);
        assertEqual('public, no-cache', response.headers.get('cache-control'));
        assertEqual(0, context.contentReads);
    });

    it('streams public bytes inline and ignores Range', async () => {
        const context = makeContext(makeFile());
        const response = new ServerResponse();

        await getPublicFile(context, makeRequest({ range: 'bytes=0-1' }), response);

        assertEqual(200, response.status);
        assertEqual('6', response.headers.get('content-length'));
        assertEqual('inline; filename="photo.png"; filename*=UTF-8\'\'photo.png',
            response.headers.get('content-disposition'));
        assertEqual(null, response.headers.get('accept-ranges'));
        assertEqual(true, response.body instanceof ReadableStream);
        assertEqual(false, context.wasCanceled());
    });

    it('streams the body of a GET admin download', async () => {
        const context = makeContext(makeFile({ isPublished: false }));
        const response = new ServerResponse();

        await getAdminFileDownload(context, makeRequest(), response);

        assertEqual(200, response.status);
        assertEqual(true, response.body instanceof ReadableStream);
        assertEqual(false, context.wasCanceled());
    });

    it('allows a private attachment download while unpublished', async () => {
        const context = makeContext(makeFile({ isPublished: false }));
        const response = new ServerResponse();

        await getAdminFileDownload(context, makeRequest({ isHeadRequest: true }), response);

        assertEqual(200, response.status);
        assertEqual(null, response.body);
        assertEqual('private, no-store', response.headers.get('cache-control'));
        assertEqual(true, context.wasCanceled());
    });
});

function makeFile(overrides) {
    return Object.assign({
        id: '123e4567-e89b-42d3-a456-426614174000',
        isPublished: true,
        content: {
            key: 'key-2',
            filename: 'photo.png',
            contentType: 'image/png',
            length: 6,
            generation: 'generation-2',
        },
    }, overrides);
}

function makeContext(file) {
    let wasCanceled = false;
    const context = {
        contentReads: 0,
        wasCanceled: () => wasCanceled,
        getCollection(name) {
            if (name === 'File') {
                return {
                    async getFile() {
                        return { toObject: () => file };
                    },
                };
            }
            if (name === 'FileContent') {
                return {
                    async get() {
                        context.contentReads += 1;
                        return {
                            body: new ReadableStream({
                                cancel() {
                                    wasCanceled = true;
                                },
                                start(controller) {
                                    controller.enqueue(new Uint8Array(6));
                                },
                            }),
                        };
                    },
                };
            }
            throw new Error(`unexpected collection ${ name }`);
        },
    };
    return context;
}

function makeRequest(options) {
    const { ifNoneMatch = null, range = null, isHeadRequest = false } = options ?? {};
    const headers = new Headers();
    if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
    if (range) headers.set('range', range);
    // A method, as on BaseServerRequest: a boolean property here once hid a
    // handler that dropped every GET body.
    return {
        headers,
        isHeadRequest: () => isHeadRequest,
        pathnameParams: { fileId: '123e4567-e89b-42d3-a456-426614174000' },
    };
}
