import { DatabaseSync } from 'node:sqlite';

import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import virtualHosts from '../../../../../../src/virtual-hosts.js';
import HttpRouter from '../../../../../../src/kixx/http-router/http-router.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import RequestContext from '../../../../../../src/kixx/context/request-context.js';
import ServerRequest from '../../../../../../src/plugins/cloudflare-server-request/lib/server-request.js';
import DocumentStore from '../../../../../../src/kixx/document-store/document-store.js';
import DocumentStoreEngine from '../../../../../../src/plugins/node-document-store-engine/lib/document-store-engine.js';
import Logger from '../../../../../../src/kixx/logger/logger.js';
import FileCollection from '../../../../../../src/app/collections/file-collection.js';
import FileContentCollection from '../../../../../../src/app/collections/file-content-collection.js';
import AdminDataApiTokenCollection from '../../../../../../src/app/collections/admin-data-api-token-collection.js';
import AdminDataApiTokenCreateForm from '../../../../../../src/app/presentation/forms/admin-data-api-tokens/admin-data-api-token-admin-form.js';
import { createAdminDataApiToken } from '../../../../../../src/app/transaction-scripts/admin-data-api-tokens/create-admin-data-api-token.js';
import { revokeAdminDataApiToken } from '../../../../../../src/app/transaction-scripts/admin-data-api-tokens/revoke-admin-data-api-token.js';


const JSON_API = 'application/vnd.api+json';
const ALL_FILE_GRANTS = [ 'File:list', 'File:get', 'File:create', 'File:update', 'File:delete' ];

// Drives the real virtual host table through HttpRouter, so mounting, route
// order, middleware, and the error cascade are exercised as deployed.
function makeHarness() {
    const storeLogger = new Logger({ name: 'Test', level: 'NONE' });
    const store = new DocumentStore({ logger: storeLogger });

    store.initialize({
        engine: new DocumentStoreEngine({ logger: storeLogger, database: new DatabaseSync(':memory:') }),
        indexes: [],
        cursorSigningSecret: 'admin-data-api-test-secret',
    });

    // The API is record-only. Registering the real content gateway over a
    // recording object store lets tests prove no request reaches the bytes.
    const objectStoreCalls = [];
    const objectStore = {
        async put(_context, _bucket, key) {
            objectStoreCalls.push(`put ${ key }`);
            return { contentLength: 0, etag: 'etag' };
        },
        async get(_context, _bucket, key) {
            objectStoreCalls.push(`get ${ key }`);
            return null;
        },
        async delete(_context, _bucket, key) {
            objectStoreCalls.push(`delete ${ key }`);
        },
    };

    const collections = new Map([
        [ 'File', new FileCollection({ db: store }) ],
        [ 'FileContent', new FileContentCollection({ store: objectStore, bucket: 'files', maxUploadBytes: 1024 }) ],
        [ 'AdminDataApiToken', new AdminDataApiTokenCollection({ db: store }) ],
    ]);

    const logEntries = [];
    const logger = {
        debug() {},
        info(message, info) {
            logEntries.push({ level: 'info', message, info });
        },
        warn(message, info) {
            logEntries.push({ level: 'warn', message, info });
        },
        error(message, info) {
            logEntries.push({ level: 'error', message, info });
        },
    };

    const router = new HttpRouter(virtualHosts);

    // The servers observe this event for logging and their fatal-error
    // policy; without a listener the emitter throws its payload instead.
    router.on('error', () => {});

    function makeContext(requestId) {
        return new RequestContext({
            config: { name: 'test-app' },
            env: {},
            runtime: { mode: 'server' },
            services: new Map(),
            collections,
            logger,
            requestId,
        });
    }

    async function mint(grants) {
        const form = new AdminDataApiTokenCreateForm({ description: 'Test token', grants });
        form.validate();
        return await createAdminDataApiToken(makeContext(), form, 'admin-user-id');
    }

    async function send(method, path, options) {
        const {
            token,
            headers,
            body,
            rawBody,
        } = options ?? {};

        const requestHeaders = new Headers(headers);

        if (token) {
            requestHeaders.set('authorization', `Bearer ${ token }`);
        }
        if ((body !== undefined || rawBody !== undefined) && !requestHeaders.has('content-type')) {
            requestHeaders.set('content-type', JSON_API);
        }

        const request = new ServerRequest(new Request(`http://localhost${ path }`, {
            method,
            headers: requestHeaders,
            body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        }));

        const response = await router.handleRequest(makeContext(request.id), request, new ServerResponse());

        return {
            status: response.status,
            headers: response.headers,
            document: response.body ? JSON.parse(response.body) : null,
        };
    }

    return {
        send,
        mint,
        makeContext,
        logEntries,
        objectStoreCalls,
        files: collections.get('File'),
    };
}

function makeContent(overrides) {
    return Object.assign({
        key: 'files/fixture/generation',
        filename: 'logo.png',
        contentType: 'image/png',
        etag: 'etag-1',
        generation: crypto.randomUUID(),
        length: 1024,
    }, overrides);
}

function fileDocument(attributes) {
    return {
        data: {
            type: 'files',
            attributes: Object.assign({
                title: 'Logo',
                description: null,
                isPublished: false,
                content: makeContent(),
            }, attributes),
        },
    };
}

function patchDocument(id, version, attributes) {
    return { data: { type: 'files', id, attributes, meta: { version } } };
}

// File sort keys start with a millisecond timestamp, so files created in the
// same millisecond would list in id order rather than creation order.
async function nextMillisecond() {
    const start = Date.now();
    while (Date.now() === start) {
        await new Promise((resolve) => {
            setTimeout(resolve, 1);
        });
    }
}

async function createFile(harness, token, attributes) {
    const result = await harness.send('POST', '/admin-data-api/v1/files', {
        token,
        body: fileDocument(attributes),
    });
    assertEqual(201, result.status);
    return result.document.data;
}

function firstError(result) {
    return result.document.errors[0];
}


describe('Administrative Data API v1', ({ describe }) => {

    describe('authentication and negotiation', ({ it }) => {

        it('challenges a request without a bearer token', async () => {
            const harness = makeHarness();
            const result = await harness.send('GET', '/admin-data-api/v1/');

            assertEqual(401, result.status);
            assertEqual('Bearer realm="admin-data-api"', result.headers.get('www-authenticate'));
            assertEqual(JSON_API, result.headers.get('content-type'));
            assertEqual('no-store', result.headers.get('cache-control'));
            assertEqual('401', firstError(result).status);
        });

        it('rejects Publishing API and revoked tokens as invalid', async () => {
            const harness = makeHarness();
            const publishing = await harness.send('GET', '/admin-data-api/v1/', { token: `kxpat_${ 'a'.repeat(64) }` });

            assertEqual(401, publishing.status);
            assertMatches('error="invalid_token"', publishing.headers.get('www-authenticate'));

            const { id, token } = await harness.mint([ 'File:list' ]);
            await revokeAdminDataApiToken(harness.makeContext(), id);
            const revoked = await harness.send('GET', '/admin-data-api/v1/files', { token });

            assertEqual(401, revoked.status);
            assertEqual('AdminDataApiTokenInactive', firstError(revoked).code);
        });

        it('returns 406 when every JSON:API Accept entry has an unsupported parameter', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:list' ]);

            const rejected = await harness.send('GET', '/admin-data-api/v1/', {
                token,
                headers: { accept: `${ JSON_API }; ext="https://example.com/ext"` },
            });
            assertEqual(406, rejected.status);
            assertEqual('Accept', firstError(rejected).source.header);

            const accepted = await harness.send('GET', '/admin-data-api/v1/', {
                token,
                headers: { accept: `${ JSON_API }; ext="https://example.com/ext", ${ JSON_API }; q=0.5` },
            });
            assertEqual(200, accepted.status);
        });

        it('marks successful responses private and uncacheable', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:list' ]);
            const result = await harness.send('GET', '/admin-data-api/v1', { token });

            assertEqual(200, result.status);
            assertEqual('private, no-store', result.headers.get('cache-control'));
            assertEqual(JSON_API, result.headers.get('content-type'));
        });
    });

    describe('discovery', ({ it }) => {

        it('describes only the granted actions and their contracts', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:list', 'File:get' ]);
            const result = await harness.send('GET', '/admin-data-api/v1/', { token });

            const [ files ] = result.document.meta.resources;
            assertEqual(1, result.document.meta.resources.length);
            assertEqual('files', files.type);
            assertEqual('list,get', files.actions.join(','));
            assertEqual('-originalUploadedAt', files.list.defaultSort);
            assertEqual(false, Object.hasOwn(files, 'create'));
            assertEqual(false, Object.hasOwn(files, 'update'));
        });

        it('rejects query parameters', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:list' ]);
            const result = await harness.send('GET', '/admin-data-api/v1/?include=files', { token });

            assertEqual(400, result.status);
            assertEqual('include', firstError(result).source.parameter);
        });
    });

    describe('resource selection and authorization', ({ it }) => {

        it('returns 404 for an unregistered type', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const result = await harness.send('GET', '/admin-data-api/v1/widgets', { token });

            assertEqual(404, result.status);
            assertEqual('AdminDataResourceTypeNotFound', firstError(result).code);
        });

        it('answers an unsupported method with the registration\'s Allow set', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            const collection = await harness.send('PUT', '/admin-data-api/v1/files', { token });
            assertEqual(405, collection.status);
            assertEqual('GET, POST', collection.headers.get('allow'));

            const resource = await harness.send('POST', '/admin-data-api/v1/files/some-id', { token });
            assertEqual(405, resource.status);
            assertEqual('GET, PATCH, DELETE', resource.headers.get('allow'));
        });

        it('denies an ungranted action before reading the body', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:list', 'File:get' ]);
            const result = await harness.send('POST', '/admin-data-api/v1/files', { token, rawBody: '{not json' });

            assertEqual(403, result.status);
            assertEqual('AdminDataActionNotGranted', firstError(result).code);
        });
    });

    describe('create', ({ it }) => {

        it('creates a record with a server id and returns it with Location', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const result = await harness.send('POST', '/admin-data-api/v1/files', { token, body: fileDocument() });

            assertEqual(201, result.status);
            const { data } = result.document;
            assertEqual('files', data.type);
            assertEqual(1, data.meta.version);
            assertEqual('Logo', data.attributes.title);
            assertMatches(/^\d{4}-\d{2}-\d{2}T/, data.attributes.originalUploadedAt);
            assertEqual(`/admin-data-api/v1/files/${ data.id }`, data.links.self);
            assertEqual(`http://localhost/admin-data-api/v1/files/${ data.id }`, result.headers.get('location'));
            assertEqual(false, Object.hasOwn(data.attributes, 'sortKey'));
        });

        it('rejects a Content-Type with media type parameters', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            for (const contentType of [ 'application/json', `${ JSON_API }; charset=utf-8` ]) {
                const result = await harness.send('POST', '/admin-data-api/v1/files', {
                    token,
                    headers: { 'content-type': contentType },
                    body: fileDocument(),
                });
                assertEqual(415, result.status);
                assertEqual('Content-Type', firstError(result).source.header);
            }
        });

        it('rejects malformed documents with pointers and stores nothing', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            const clientId = fileDocument();
            clientId.data.id = 'chosen-by-client';
            const typeMismatch = fileDocument();
            typeMismatch.data.type = 'widgets';
            const relationships = fileDocument();
            relationships.data.relationships = {};

            const cases = [
                [ { rawBody: '{not json' }, 400, null ],
                [ { body: clientId }, 403, '/data/id' ],
                [ { body: typeMismatch }, 409, '/data/type' ],
                [ { body: relationships }, 400, '/data/relationships' ],
                [ { body: { data: { type: 'files' } } }, 400, '/data/attributes' ],
            ];

            for (const [ options, status, pointer ] of cases) {
                const result = await harness.send('POST', '/admin-data-api/v1/files', Object.assign({ token }, options));
                assertEqual(status, result.status);
                if (pointer) {
                    assertEqual(pointer, firstError(result).source.pointer);
                }
            }

            const list = await harness.send('GET', '/admin-data-api/v1/files', { token });
            assertEqual(0, list.document.data.length);
        });

        it('rejects undeclared, read-only, missing, and invalid attributes as 422', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            const undeclared = await harness.send('POST', '/admin-data-api/v1/files', {
                token,
                body: fileDocument({ secret: 'x', originalUploadedAt: '2020-01-01T00:00:00.000Z' }),
            });
            assertEqual(422, undeclared.status);
            const pointers = undeclared.document.errors.map((error) => error.source.pointer);
            assertEqual('/data/attributes/secret,/data/attributes/originalUploadedAt', pointers.join(','));

            const missing = fileDocument();
            delete missing.data.attributes.isPublished;
            const missingResult = await harness.send('POST', '/admin-data-api/v1/files', { token, body: missing });
            assertEqual(422, missingResult.status);
            assertEqual('/data/attributes/isPublished', firstError(missingResult).source.pointer);

            const invalid = await harness.send('POST', '/admin-data-api/v1/files', {
                token,
                body: fileDocument({ content: makeContent({ key: '' }) }),
            });
            assertEqual(422, invalid.status);
            assertEqual('/data/attributes/content/key', firstError(invalid).source.pointer);

            const list = await harness.send('GET', '/admin-data-api/v1/files', { token });
            assertEqual(0, list.document.data.length);
        });
    });

    describe('get', ({ it }) => {

        it('returns declared attributes narrowed by a sparse fieldset', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);

            const result = await harness.send('GET', `/admin-data-api/v1/files/${ created.id }?fields[files]=title`, { token });

            assertEqual(200, result.status);
            assertEqual('title', Object.keys(result.document.data.attributes).join(','));
            assertEqual(created.meta.version, result.document.data.meta.version);
        });

        it('rejects an undeclared fieldset member', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);

            const result = await harness.send('GET', `/admin-data-api/v1/files/${ created.id }?fields[files]=sortKey`, { token });

            assertEqual(400, result.status);
            assertEqual('fields[files]', firstError(result).source.parameter);
        });

        it('returns 404 for absent ids, including ids no record can have', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            for (const id of [ 'missing', '%01' ]) {
                const result = await harness.send('GET', `/admin-data-api/v1/files/${ id }`, { token });
                assertEqual(404, result.status);
                assertEqual('AdminDataRecordNotFound', firstError(result).code);
            }
        });
    });

    describe('list', ({ it }) => {

        it('pages newest first with complete next links that preserve the query', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const first = await createFile(harness, token, { title: 'First' });
            await nextMillisecond();
            const second = await createFile(harness, token, { title: 'Second' });
            await nextMillisecond();
            const third = await createFile(harness, token, { title: 'Third' });

            const page1 = await harness.send('GET', '/admin-data-api/v1/files?page[size]=2&fields[files]=title', { token });

            assertEqual(200, page1.status);
            assertEqual(`${ third.id },${ second.id }`, page1.document.data.map((item) => item.id).join(','));

            const next = new URL(page1.document.links.next);
            assertEqual('http://localhost', next.origin);
            assertEqual('2', next.searchParams.get('page[size]'));
            assertEqual('title', next.searchParams.get('fields[files]'));
            assert(next.searchParams.get('page[after]'));

            const page2 = await harness.send('GET', `${ next.pathname }${ next.search }`, { token });

            assertEqual(first.id, page2.document.data.map((item) => item.id).join(','));
            assertEqual('title', Object.keys(page2.document.data[0].attributes).join(','));
            assertEqual(false, Object.hasOwn(page2.document.links, 'next'));
        });

        it('rejects invalid query parameters and tampered cursors', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            const cases = [
                [ 'page[size]=0', 'page[size]' ],
                [ 'page[size]=101', 'page[size]' ],
                [ 'page[size]=2.5', 'page[size]' ],
                [ 'sort=title', 'sort' ],
                [ 'sort=-originalUploadedAt&sort=-originalUploadedAt', 'sort' ],
                [ 'filter[title]=x', 'filter[title]' ],
                [ 'page[after]=forged.cursor', 'page[after]' ],
            ];

            for (const [ query, parameter ] of cases) {
                const result = await harness.send('GET', `/admin-data-api/v1/files?${ query }`, { token });
                assertEqual(400, result.status, query);
                assertEqual(parameter, firstError(result).source.parameter, query);
            }
        });
    });

    describe('update', ({ it }) => {

        it('preserves document validation precedence before writable field checks', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const path = '/admin-data-api/v1/files/example';
            const cases = [
                [ { data: { type: 'wrong', id: 'wrong', attributes: null } }, 409, 'JsonApiResourceTypeMismatch', '/data/type' ],
                [ { data: { type: 'files', id: 'wrong', attributes: null } }, 409, 'JsonApiResourceIdMismatch', '/data/id' ],
                [ { data: { type: 'files', id: 'example', attributes: null } }, 400, 'JsonApiInvalidDocument', '/data/attributes' ],
                [ { data: { type: 'files', id: 'example', attributes: { unknown: true }, meta: null } },
                    400, 'AdminDataInvalidVersion', '/data/meta/version' ],
                [ { data: { type: 'files', id: 'example', attributes: { unknown: true }, meta: { version: 1 } } },
                    422, 'VALIDATION_ERROR', '/data/attributes/unknown' ],
            ];

            for (const [ body, status, code, pointer ] of cases) {
                const result = await harness.send('PATCH', path, { token, body });
                assertEqual(status, result.status);
                assertEqual(code, firstError(result).code);
                assertEqual(pointer, firstError(result).source.pointer);
            }
        });

        it('replaces supplied attributes whole and preserves omitted ones', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token, { description: 'Kept' });
            const content = makeContent({ key: 'files/other/generation', etag: 'etag-2' });

            const result = await harness.send('PATCH', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                body: patchDocument(created.id, 1, { title: null, content }),
            });

            assertEqual(200, result.status);
            const { data } = result.document;
            assertEqual(2, data.meta.version);
            assertEqual(null, data.attributes.title);
            assertEqual('Kept', data.attributes.description);
            assertEqual(JSON.stringify(content), JSON.stringify(data.attributes.content));
            assertEqual(created.attributes.originalUploadedAt, data.attributes.originalUploadedAt);
        });

        it('rejects incomplete replacement content without borrowing stored members', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            const result = await harness.send('PATCH', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                body: patchDocument(created.id, 1, { content: { filename: 'replacement.png' } }),
            });

            assertEqual(422, result.status);
            assert(result.document.errors.some((error) => error.source.pointer === '/data/attributes/content/key'));
            const stored = await harness.files.get(harness.makeContext(), created.id);
            assertEqual(1, stored.version);
            assertEqual(created.attributes.content.filename, stored.get('content').filename);
        });

        it('requires a valid observed version and a matching id', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            const path = `/admin-data-api/v1/files/${ created.id }`;

            const missingVersion = await harness.send('PATCH', path, {
                token,
                body: { data: { type: 'files', id: created.id, attributes: { title: 'x' } } },
            });
            assertEqual(400, missingVersion.status);
            assertEqual('/data/meta/version', firstError(missingVersion).source.pointer);

            const idMismatch = await harness.send('PATCH', path, {
                token,
                body: patchDocument('other-id', 1, { title: 'x' }),
            });
            assertEqual(409, idMismatch.status);
            assertEqual('/data/id', firstError(idMismatch).source.pointer);

            const invalidValue = await harness.send('PATCH', path, {
                token,
                body: patchDocument(created.id, 1, { isPublished: null }),
            });
            assertEqual(422, invalidValue.status);

            const stored = await harness.files.get(harness.makeContext(), created.id);
            assertEqual(1, stored.version);
            assertEqual(false, stored.get('isPublished'));
        });

        it('lets only one of two clients holding the same version succeed', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            const path = `/admin-data-api/v1/files/${ created.id }`;

            const winner = await harness.send('PATCH', path, { token, body: patchDocument(created.id, 1, { title: 'A' }) });
            const loser = await harness.send('PATCH', path, { token, body: patchDocument(created.id, 1, { title: 'B' }) });

            assertEqual(200, winner.status);
            assertEqual(409, loser.status);
            assertEqual('AdminDataVersionConflict', firstError(loser).code);

            const stored = await harness.files.get(harness.makeContext(), created.id);
            assertEqual('A', stored.get('title'));
        });

        it('does not overwrite a write that lands after the record was loaded', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            const tracker = new MockTracker();
            const originalGet = harness.files.get.bind(harness.files);

            // Another writer commits between this request's load and its write.
            tracker.method(harness.files, 'get', async (context, id) => {
                const loaded = await originalGet(context, id);
                const concurrent = await originalGet(context, id);
                concurrent.set('title', 'Concurrent');
                await harness.files.update(context, concurrent);
                return loaded;
            }, { times: 1 });

            const result = await harness.send('PATCH', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                body: patchDocument(created.id, 1, { title: 'Late' }),
            });
            tracker.reset();

            assertEqual(409, result.status);
            const stored = await harness.files.get(harness.makeContext(), created.id);
            assertEqual('Concurrent', stored.get('title'));
        });
    });

    describe('delete', ({ it }) => {

        it('requires the observed version header', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);

            for (const headers of [ {}, { 'kixx-expected-version': 'one' }, { 'kixx-expected-version': '0' } ]) {
                const result = await harness.send('DELETE', `/admin-data-api/v1/files/${ created.id }`, { token, headers });
                assertEqual(400, result.status);
                assertEqual('Kixx-Expected-Version', firstError(result).source.header);
            }
        });

        it('deletes the observed version and refuses a stale one', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token, { isPublished: true });
            const path = `/admin-data-api/v1/files/${ created.id }`;

            await harness.send('PATCH', path, { token, body: patchDocument(created.id, 1, { title: 'Changed' }) });

            const stale = await harness.send('DELETE', path, { token, headers: { 'kixx-expected-version': '1' } });
            assertEqual(409, stale.status);
            assert(await harness.files.get(harness.makeContext(), created.id));

            const deleted = await harness.send('DELETE', path, { token, headers: { 'kixx-expected-version': '2' } });
            assertEqual(204, deleted.status);
            assertEqual(null, deleted.document);
            assertEqual(null, await harness.files.get(harness.makeContext(), created.id));

            const again = await harness.send('DELETE', path, { token, headers: { 'kixx-expected-version': '2' } });
            assertEqual(404, again.status);
        });

        it('does not delete a record changed after it was loaded', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            const tracker = new MockTracker();
            const originalGet = harness.files.get.bind(harness.files);

            tracker.method(harness.files, 'get', async (context, id) => {
                const loaded = await originalGet(context, id);
                const concurrent = await originalGet(context, id);
                concurrent.set('title', 'Concurrent');
                await harness.files.update(context, concurrent);
                return loaded;
            }, { times: 1 });

            const result = await harness.send('DELETE', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                headers: { 'kixx-expected-version': '1' },
            });
            tracker.reset();

            assertEqual(409, result.status);
            const stored = await harness.files.get(harness.makeContext(), created.id);
            assertEqual('Concurrent', stored.get('title'));
        });
    });

    describe('record-only File content references', ({ it }) => {

        it('never reads, writes, or deletes bytes on create, repoint, or delete', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token, { isPublished: true });
            const path = `/admin-data-api/v1/files/${ created.id }`;

            const replacement = makeContent({ key: 'files/other/generation', filename: 'other.png' });
            const repointed = await harness.send('PATCH', path, {
                token,
                body: patchDocument(created.id, 1, { content: replacement }),
            });
            assertEqual(200, repointed.status);
            assertEqual('files/other/generation', repointed.document.data.attributes.content.key);

            const deleted = await harness.send('DELETE', path, { token, headers: { 'kixx-expected-version': '2' } });
            assertEqual(204, deleted.status);

            assertEqual(0, harness.objectStoreCalls.length);
        });

        it('rejects content reference members FileRecord does not define', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);

            const created = await harness.send('POST', '/admin-data-api/v1/files', {
                token,
                body: fileDocument({ content: makeContent({ ownerId: 'someone' }) }),
            });
            assertEqual(422, created.status);
            assertEqual('/data/attributes/content/ownerId', firstError(created).source.pointer);

            const list = await harness.send('GET', '/admin-data-api/v1/files', { token });
            assertEqual(0, list.document.data.length);
        });

        it('advertises the closed content reference shape in discovery', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint([ 'File:get' ]);
            const result = await harness.send('GET', '/admin-data-api/v1/', { token });

            const [ files ] = result.document.meta.resources;
            assertEqual(false, files.attributes.content.schema.additionalProperties);
            assertEqual(6, files.attributes.content.schema.required.length);
        });
    });

    describe('audit logging and unexpected errors', ({ it }) => {

        it('logs rejected mutations once, including failures before authorization', async () => {
            const harness = makeHarness();
            const { token, id: tokenId } = await harness.mint(ALL_FILE_GRANTS);
            const reader = await harness.mint([ 'File:get' ]);
            const cases = [
                [ 'POST', '/admin-data-api/v1/files', {}, 401, null, 'create' ],
                [ 'DELETE', '/admin-data-api/v1/files/example', { token: reader.token }, 403, reader.id, 'delete' ],
                [ 'PATCH', '/admin-data-api/v1/unknown/example', { token }, 404, tokenId, 'update' ],
                [ 'POST', '/admin-data-api/v1/files', { token, rawBody: '{invalid' }, 400, tokenId, 'create' ],
                [ 'POST', '/admin-data-api/v1/files', {
                    token,
                    headers: { accept: `${ JSON_API }; ext="unsupported"` },
                }, 406, tokenId, 'create' ],
                [ 'POST', '/admin-data-api/v1/files', {
                    token,
                    headers: { 'content-type': 'application/json' },
                    body: fileDocument(),
                }, 415, tokenId, 'create' ],
                [ 'POST', '/admin-data-api/v1/files', {
                    token,
                    body: fileDocument({ secret: 'Never log this payload' }),
                }, 422, tokenId, 'create' ],
            ];

            for (const [ method, path, options, status, principal, action ] of cases) {
                harness.logEntries.length = 0;
                const result = await harness.send(method, path, options);
                assertEqual(status, result.status);

                const entries = harness.logEntries.filter((entry) => entry.message.startsWith('admin data mutation'));
                assertEqual(1, entries.length);
                const [ entry ] = entries;
                assertEqual('warn', entry.level);
                assertEqual('failed', entry.info.outcome);
                assertEqual(status, entry.info.status);
                assertEqual(firstError(result).code, entry.info.code);
                assertEqual(principal, entry.info.principal);
                assertEqual(action, entry.info.action);
                assertEqual(path.split('/')[3], entry.info.type);
                assertEqual(path.split('/')[4], entry.info.id);
                assert(entry.info.requestId);
                assertEqual(false, JSON.stringify(entries).includes(token));
                assertEqual(false, JSON.stringify(entries).includes('Never log this payload'));
            }

            harness.logEntries.length = 0;
            await harness.send('GET', '/admin-data-api/v1/files');
            assertEqual(0, harness.logEntries.filter((entry) => entry.message.startsWith('admin data mutation')).length);
        });

        it('logs successful create, update, and delete once with their record id', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token);
            await harness.send('PATCH', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                body: patchDocument(created.id, 1, { title: 'Updated' }),
            });
            await harness.send('DELETE', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                headers: { 'kixx-expected-version': '2' },
            });

            const entries = harness.logEntries.filter((entry) => entry.message.startsWith('admin data mutation'));
            assertEqual('create,update,delete', entries.map((entry) => entry.info.action).join(','));
            for (const entry of entries) {
                assertEqual('succeeded', entry.info.outcome);
                assertEqual(created.id, entry.info.id);
            }
        });

        it('logs every mutation outcome without secrets or payloads', async () => {
            const harness = makeHarness();
            const { id: tokenId, token } = await harness.mint(ALL_FILE_GRANTS);
            const created = await createFile(harness, token, { title: 'Sensitive title' });

            await harness.send('DELETE', `/admin-data-api/v1/files/${ created.id }`, {
                token,
                headers: { 'kixx-expected-version': '9' },
            });

            const entries = harness.logEntries.filter((entry) => entry.message.startsWith('admin data mutation'));
            assertEqual(2, entries.length);

            const [ success, failure ] = entries;
            assertEqual('succeeded', success.info.outcome);
            assertEqual('create', success.info.action);
            assertEqual('files', success.info.type);
            assertEqual(created.id, success.info.id);
            assertEqual(tokenId, success.info.principal);
            assert(success.info.requestId);

            assertEqual('warn', failure.level);
            assertEqual('failed', failure.info.outcome);
            assertEqual('delete', failure.info.action);
            assertEqual(409, failure.info.status);

            const logged = JSON.stringify(entries);
            assertEqual(false, logged.includes(token));
            assertEqual(false, logged.includes('Sensitive title'));
        });

        it('logs unexpected mutation failures and still propagates them past the API error handler', async () => {
            const harness = makeHarness();
            const { token } = await harness.mint(ALL_FILE_GRANTS);
            const tracker = new MockTracker();

            tracker.method(harness.files, 'get', async () => {
                throw new Error('disk on fire');
            });

            let error;
            try {
                await harness.send('PATCH', '/admin-data-api/v1/files/any-id', {
                    token,
                    body: patchDocument('any-id', 1, { title: 'Private payload' }),
                });
            } catch (cause) {
                error = cause;
            }
            tracker.reset();

            assert(error);
            assertEqual('AssertionError', error.name);
            const entries = harness.logEntries.filter((entry) => entry.message.startsWith('admin data mutation'));
            assertEqual(1, entries.length);
            assertEqual('failed', entries[0].info.outcome);
            assertEqual(500, entries[0].info.status);
            assertEqual('update', entries[0].info.action);
            assertEqual('any-id', entries[0].info.id);
            assertEqual(false, JSON.stringify(entries).includes('Private payload'));
        });
    });
});
