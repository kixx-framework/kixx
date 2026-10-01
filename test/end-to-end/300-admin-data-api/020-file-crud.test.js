import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import {
    FileFixtures,
    UUID_PATTERN,
    createFixtureFilename,
    fetchPathname,
    openUploadPage,
} from '../100-admin-files/helpers.js';
import {
    ApiFileFixtures,
    JSON_API,
    apiRequest,
    createDataToken,
    fileCreateDocument,
    filePatchDocument,
    revokeDataToken,
} from './helpers.js';


const SOURCE_BODY = 'admin data API source bytes\n';
const OTHER_BODY = 'admin data API other bytes\n';
const CONTENT_FIELDS = 'contentType,etag,filename,generation,key,length';

let rootCookies;
let uploads;
let records;
let dataToken;

// Admin-panel uploads whose bytes the API records borrow. The API never owns
// these bytes; the upload fixtures delete them after the API records are gone.
let source;
let other;
let sourceContent;
let otherContent;


/**
 * Asserts that an admin-uploaded File still serves its original bytes.
 * @param {string} fileId - Admin-uploaded File id.
 * @param {string} body - Expected bytes.
 * @returns {Promise<void>}
 */
async function assertBytesIntact(fileId, body) {
    const download = await fetchPathname(rootCookies, `/admin/files/${ fileId }/download`);
    assertEqual(200, download.status, `download ${ fileId }`);
    assertEqual(body, download.text, `bytes of ${ fileId }`);
}


describe('Admin Data API File CRUD', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();

        const { csrfToken } = await openUploadPage(rootCookies);
        uploads = new FileFixtures(rootCookies, csrfToken);
        source = await uploads.upload(createFixtureFilename('admin-data-source', 'txt'), SOURCE_BODY);
        other = await uploads.upload(createFixtureFilename('admin-data-other', 'txt'), OTHER_BODY);

        dataToken = await createDataToken(rootCookies, [
            'File:list',
            'File:get',
            'File:create',
            'File:update',
            'File:delete',
        ]);
        records = new ApiFileFixtures(dataToken.token);

        const sourceRead = await apiRequest(dataToken.token, 'GET', `/files/${ source.id }`);
        assertEqual(200, sourceRead.status, 'read source content reference');
        sourceContent = sourceRead.document.data.attributes.content;

        const otherRead = await apiRequest(dataToken.token, 'GET', `/files/${ other.id }`);
        assertEqual(200, otherRead.status, 'read other content reference');
        otherContent = otherRead.document.data.attributes.content;
    });

    // Order matters: API records reference the uploads' bytes, so remove the
    // records before the upload fixtures delete those bytes.
    after(async () => {
        try {
            await records?.cleanup();
        } finally {
            try {
                await uploads?.cleanup();
            } finally {
                if (dataToken) {
                    await revokeDataToken(rootCookies, dataToken.id);
                }
            }
        }
    });

    describe('get', ({ it }) => {

        it('returns declared attributes and server-owned meta for an admin-uploaded File', async () => {
            const result = await apiRequest(dataToken.token, 'GET', `/files/${ source.id }`);

            assertEqual(200, result.status);
            assertEqual(JSON_API, result.response.headers.get('content-type'));

            const { data } = result.document;
            assertEqual('files', data.type);
            assertEqual(source.id, data.id);
            assertEqual('content,description,isPublished,originalUploadedAt,title', Object.keys(data.attributes).sort().join(','));
            assertEqual(CONTENT_FIELDS, Object.keys(data.attributes.content).sort().join(','));
            assertEqual(new TextEncoder().encode(SOURCE_BODY).byteLength, data.attributes.content.length);
            assert(Number.isSafeInteger(data.meta.version), 'meta.version');
            assertEqual(`/admin-data-api/v1/files/${ source.id }`, data.links.self);
        });

        it('narrows attributes with a sparse fieldset', async () => {
            const result = await apiRequest(dataToken.token, 'GET', `/files/${ source.id }?fields[files]=title`);

            assertEqual(200, result.status);
            assertEqual('title', Object.keys(result.document.data.attributes).join(','));
        });

        it('returns 404 for an id with no record', async () => {
            const result = await apiRequest(dataToken.token, 'GET', `/files/${ crypto.randomUUID() }`);

            assertEqual(404, result.status);
            assertEqual('AdminDataRecordNotFound', result.document.errors[0].code);
        });
    });

    describe('create and list', ({ before, it }) => {
        let created;
        let createResult;

        before(async () => {
            createResult = await apiRequest(dataToken.token, 'POST', '/files', {
                body: fileCreateDocument(sourceContent, { isPublished: true }),
            });
            records.track(createResult.document?.data?.id);
            created = createResult.document?.data;
        });

        it('creates a record with a server id that references existing bytes', async () => {
            assertEqual(201, createResult.status, createResult.text.slice(0, 200));
            assert(UUID_PATTERN.test(created.id), 'server-generated UUID');
            assert(created.id !== source.id, 'a new record, not the source');
            assertEqual(1, created.meta.version);
            assertMatches(`/admin-data-api/v1/files/${ created.id }`, createResult.response.headers.get('location'));
            assertEqual(sourceContent.key, created.attributes.content.key);
            assertMatches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, created.attributes.originalUploadedAt);

            // The published record serves the borrowed bytes publicly.
            const publicGet = await fetchPathname(null, `/files/${ created.id }`);
            assertEqual(200, publicGet.status);
            assertEqual(SOURCE_BODY, publicGet.text);
        });

        it('rejects a client id, a read-only attribute, and unknown content members', async () => {
            const clientId = fileCreateDocument(sourceContent);
            clientId.data.id = crypto.randomUUID();
            const clientIdResult = await apiRequest(dataToken.token, 'POST', '/files', { body: clientId });
            assertEqual(403, clientIdResult.status);

            const readOnly = await apiRequest(dataToken.token, 'POST', '/files', {
                body: fileCreateDocument(sourceContent, { originalUploadedAt: '2020-01-01T00:00:00.000Z' }),
            });
            assertEqual(422, readOnly.status);
            assertEqual('/data/attributes/originalUploadedAt', readOnly.document.errors[0].source.pointer);

            const extraMember = await apiRequest(dataToken.token, 'POST', '/files', {
                body: fileCreateDocument(Object.assign({}, sourceContent, { ownerId: 'someone' })),
            });
            assertEqual(422, extraMember.status);
            assertEqual('/data/attributes/content/ownerId', extraMember.document.errors[0].source.pointer);
        });

        it('lists newest first and pages with complete next links', async () => {
            const page = await apiRequest(dataToken.token, 'GET', '/files?page[size]=100');
            assertEqual(200, page.status);

            const ids = page.document.data.map((resource) => resource.id);
            const createdIndex = ids.indexOf(created.id);
            const sourceIndex = ids.indexOf(source.id);
            assert(createdIndex >= 0 && sourceIndex >= 0, 'both records listed');
            assert(createdIndex < sourceIndex, 'newer record listed first');

            const first = await apiRequest(dataToken.token, 'GET', '/files?page[size]=1');
            assertEqual(1, first.document.data.length);

            const next = new URL(first.document.links.next);
            assertEqual('/admin-data-api/v1/files', next.pathname);
            assertEqual('1', next.searchParams.get('page[size]'));
            assert(next.searchParams.get('page[after]'), 'cursor');

            const second = await apiRequest(dataToken.token, 'GET', first.document.links.next);
            assertEqual(200, second.status);
            assert(second.document.data[0].id !== first.document.data[0].id, 'next page advances');
        });

        it('rejects a tampered cursor and an oversized page', async () => {
            const tampered = await apiRequest(dataToken.token, 'GET', '/files?page[after]=not-a-cursor');
            assertEqual(400, tampered.status);
            assertEqual('AdminDataInvalidCursor', tampered.document.errors[0].code);

            const oversized = await apiRequest(dataToken.token, 'GET', '/files?page[size]=101');
            assertEqual(400, oversized.status);
            assertEqual('page[size]', oversized.document.errors[0].source.parameter);
        });
    });

    describe('update', ({ before, it }) => {
        let record;
        let path;

        before(async () => {
            record = await records.create(fileCreateDocument(sourceContent, { description: 'kept' }));
            path = `/files/${ record.id }`;
        });

        it('replaces supplied attributes and preserves omitted ones', async () => {
            const result = await apiRequest(dataToken.token, 'PATCH', path, {
                body: filePatchDocument(record.id, 1, { title: 'Renamed' }),
            });

            assertEqual(200, result.status);
            assertEqual('Renamed', result.document.data.attributes.title);
            assertEqual('kept', result.document.data.attributes.description);
            assertEqual(2, result.document.data.meta.version);
        });

        it('refuses a stale version without changing the record', async () => {
            const stale = await apiRequest(dataToken.token, 'PATCH', path, {
                body: filePatchDocument(record.id, 1, { title: 'Stale' }),
            });
            assertEqual(409, stale.status);
            assertEqual('AdminDataVersionConflict', stale.document.errors[0].code);

            const current = await apiRequest(dataToken.token, 'GET', path);
            assertEqual('Renamed', current.document.data.attributes.title);
            assertEqual(2, current.document.data.meta.version);
        });

        it('lets only one of two writers holding the same version succeed', async () => {
            const results = await Promise.all([ 'Writer A', 'Writer B' ].map((title) => {
                return apiRequest(dataToken.token, 'PATCH', path, {
                    body: filePatchDocument(record.id, 2, { title }),
                });
            }));

            const statuses = results.map((result) => result.status).sort();
            assertEqual('200,409', statuses.join(','));

            const winner = results.find((result) => result.status === 200);
            const current = await apiRequest(dataToken.token, 'GET', path);
            assertEqual(winner.document.data.attributes.title, current.document.data.attributes.title);
            assertEqual(3, current.document.data.meta.version);
        });

        it('requires a version and a matching id', async () => {
            const missingVersion = await apiRequest(dataToken.token, 'PATCH', path, {
                body: { data: { type: 'files', id: record.id, attributes: { title: 'x' } } },
            });
            assertEqual(400, missingVersion.status);
            assertEqual('AdminDataInvalidVersion', missingVersion.document.errors[0].code);

            const wrongId = await apiRequest(dataToken.token, 'PATCH', path, {
                body: filePatchDocument(crypto.randomUUID(), 3, { title: 'x' }),
            });
            assertEqual(409, wrongId.status);
        });

        it('repoints content without touching either File\'s bytes', async () => {
            const current = await apiRequest(dataToken.token, 'GET', path);
            const result = await apiRequest(dataToken.token, 'PATCH', path, {
                body: filePatchDocument(record.id, current.document.data.meta.version, { content: otherContent }),
            });

            assertEqual(200, result.status);
            assertEqual(otherContent.key, result.document.data.attributes.content.key);

            await assertBytesIntact(source.id, SOURCE_BODY);
            await assertBytesIntact(other.id, OTHER_BODY);
        });
    });

    describe('delete', ({ before, it }) => {
        let record;
        let path;

        before(async () => {
            record = await records.create(fileCreateDocument(sourceContent, { isPublished: true }));
            path = `/files/${ record.id }`;
            await apiRequest(dataToken.token, 'PATCH', path, {
                body: filePatchDocument(record.id, 1, { title: 'Advanced' }),
            });
        });

        it('refuses a stale or missing version', async () => {
            const stale = await apiRequest(dataToken.token, 'DELETE', path, {
                headers: { 'kixx-expected-version': '1' },
            });
            assertEqual(409, stale.status);

            const missing = await apiRequest(dataToken.token, 'DELETE', path);
            assertEqual(400, missing.status);
            assertEqual('Kixx-Expected-Version', missing.document.errors[0].source.header);

            const current = await apiRequest(dataToken.token, 'GET', path);
            assertEqual(200, current.status);
        });

        it('deletes a published record at the observed version and leaves its bytes', async () => {
            const deleted = await apiRequest(dataToken.token, 'DELETE', path, {
                headers: { 'kixx-expected-version': '2' },
            });
            assertEqual(204, deleted.status);
            assertEqual('', deleted.text);

            const gone = await apiRequest(dataToken.token, 'GET', path);
            assertEqual(404, gone.status);

            await assertBytesIntact(source.id, SOURCE_BODY);
        });
    });
});
