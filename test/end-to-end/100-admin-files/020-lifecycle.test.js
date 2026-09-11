import { describe } from 'kixx-test';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import validateHtml from '../test-helpers/validate-html.js';
import {
    FileFixtures,
    UUID_PATTERN,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    openUploadPage,
    postFileAction,
    sendUpload,
} from './helpers.js';


const FIRST_BODY = 'first version\n';
// A PNG signature and IHDR prefix: enough for the extension map and inline
// policy, and distinct from the first version's bytes.
const REPLACEMENT_BODY = new Uint8Array([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d ]);

let rootCookies;
let csrfToken;
let maxUploadBytes;
let fixtures;

// The file whose lifecycle this suite follows, and a later identical upload.
let original;
let duplicate;
let originalFilename;
let publicPathname;
let firstEtag;
let replacementEtag;


describe('Admin file lifecycle', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();
        ({ csrfToken, maxUploadBytes } = await openUploadPage(rootCookies));
        fixtures = new FileFixtures(rootCookies, csrfToken);
    });

    after(async () => {
        await fixtures?.cleanup();
    });

    describe('upload', ({ before, it }) => {
        let firstResult;
        let duplicateResult;

        before(async () => {
            originalFilename = createFixtureFilename('lifecycle', 'txt');

            // The browser-claimed MIME type is untrusted; the server derives the
            // type from the filename extension instead.
            firstResult = await sendUpload(rootCookies, {
                csrfToken,
                filename: originalFilename,
                body: FIRST_BODY,
                contentType: 'text/html',
            });
            original = firstResult.json?.file;
            if (original) {
                fixtures.track(original.id);
                publicPathname = `/files/${ original.id }`;
            }

            duplicateResult = await sendUpload(rootCookies, { csrfToken, filename: originalFilename, body: FIRST_BODY });
            duplicate = duplicateResult.json?.file;
            if (duplicate) {
                fixtures.track(duplicate.id);
            }
        });

        it('creates an unpublished file with a random UUID', () => {
            assertEqual(201, firstResult.status);
            assert(UUID_PATTERN.test(original.id), 'file id is a UUID');
            assertEqual(false, original.isPublished);
            assertEqual(null, original.title);
            assertEqual(null, original.description);
        });

        it('records the uploaded content, ignoring the browser MIME claim', () => {
            assertEqual(originalFilename, original.content.filename);
            assertEqual(new TextEncoder().encode(FIRST_BODY).byteLength, original.content.length);
            assertEqual('text/plain; charset=utf-8', original.content.contentType);
        });

        it('returns the stable public pathname before publishing', () => {
            assertEqual(publicPathname, firstResult.json.links.public);
            assertEqual(`/admin/files/${ original.id }`, firstResult.json.links.detail);
        });

        it('never deduplicates identical uploads', () => {
            assertEqual(201, duplicateResult.status);
            assert(duplicate.id !== original.id, 'duplicate upload has its own UUID');
        });
    });

    describe('while unpublished', ({ before, it }) => {
        let publicGet;
        let publicStar;
        let detail;
        let download;
        let downloadHead;

        before(async () => {
            publicGet = await fetchPathname(null, publicPathname);
            publicStar = await fetchPathname(null, publicPathname, { headers: { 'if-none-match': '*' } });
            detail = await fetchPathname(rootCookies, `/admin/files/${ original.id }`);
            download = await fetchPathname(rootCookies, `/admin/files/${ original.id }/download`);
            downloadHead = await fetchPathname(rootCookies, `/admin/files/${ original.id }/download`, { method: 'HEAD' });
        });

        it('returns a non-cacheable 404 at the public URL without metadata', () => {
            assertEqual(404, publicGet.status);
            assertEqual('no-store', publicGet.response.headers.get('cache-control'));
            assertEqual(null, publicGet.response.headers.get('etag'));
            assert(!publicGet.text.includes(originalFilename), 'no filename disclosure');
        });

        it('never answers a wildcard validator with 304', () => {
            assertEqual(404, publicStar.status);
        });

        it('renders the detail page with the permanent URL', async () => {
            assertEqual(200, detail.status);
            await validateHtml(detail.text);

            const document = new FastHTMLParser(detail.text);
            assertEqual(`${ getBaseUrl() }${ publicPathname }`, document.getElementById('file-public-url').getAttribute('value'));
            assertMatches('Unpublished', detail.text);
        });

        it('serves a private attachment download', () => {
            assertEqual(200, download.status);
            assertEqual(FIRST_BODY, download.text);
            assertEqual('private, no-store', download.response.headers.get('cache-control'));
            assertMatches(/^attachment; /u, download.response.headers.get('content-disposition'));
            assertEqual('nosniff', download.response.headers.get('x-content-type-options'));
        });

        it('answers HEAD on the download without a body', () => {
            assertEqual(200, downloadHead.status);
            assertEqual(0, downloadHead.bytes.byteLength);
            assertEqual(String(original.content.length), downloadHead.response.headers.get('content-length'));
        });
    });

    describe('metadata', ({ before, it }) => {
        let formSave;
        let detailAfterSave;
        let partialSave;
        let invalidForm;
        let invalidPartial;
        let detailAfterInvalid;
        let blankSave;

        before(async () => {
            formSave = await postFileAction(rootCookies, csrfToken, original.id, 'metadata', {
                fields: { title: 'Lifecycle title', description: 'Lifecycle description' },
            });
            detailAfterSave = await fetchPathname(rootCookies, formSave.location);

            partialSave = await postFileAction(rootCookies, csrfToken, original.id, 'metadata', {
                fields: { title: 'Partial title', description: 'Partial description' },
                isPartial: true,
            });

            invalidForm = await postFileAction(rootCookies, csrfToken, original.id, 'metadata', {
                fields: { title: 'x'.repeat(201), description: '' },
            });
            invalidPartial = await postFileAction(rootCookies, csrfToken, original.id, 'metadata', {
                fields: { title: '', description: 'x'.repeat(2001) },
                isPartial: true,
            });
            detailAfterInvalid = await fetchPathname(rootCookies, invalidForm.location);

            blankSave = await postFileAction(rootCookies, csrfToken, duplicate.id, 'metadata', {
                fields: { title: '  ', description: '' },
                isPartial: true,
            });
        });

        it('redirects a form save to the detail page showing the metadata', () => {
            assertEqual(303, formSave.status);
            assertEqual(`/admin/files/${ original.id }`, formSave.location);
            assertEqual(200, detailAfterSave.status);
            assertMatches('<h1>Lifecycle title</h1>', detailAfterSave.text);
            assertMatches('Lifecycle description', detailAfterSave.text);
        });

        it('returns the updated file to a JavaScript save without changing other fields', () => {
            assertEqual(200, partialSave.status);
            assertEqual('Partial title', partialSave.json.file.title);
            assertEqual('Partial description', partialSave.json.file.description);
            assertEqual(false, partialSave.json.file.isPublished);
            assertEqual(original.content.generation, partialSave.json.file.content.generation);
        });

        it('rejects out-of-bounds metadata and keeps the saved values', () => {
            assertEqual(303, invalidForm.status);
            assertEqual(`/admin/files/${ original.id }?notice=metadata_invalid`, invalidForm.location);
            assertMatches('The metadata could not be saved', detailAfterInvalid.text);
            assertMatches('<h1>Partial title</h1>', detailAfterInvalid.text);

            assertEqual(422, invalidPartial.status);
            assertEqual('VALIDATION_ERROR', invalidPartial.json?.error?.code);
            assert(invalidPartial.json.form?.fields?.description?.error, 'description field error');
        });

        it('stores a blank title as null so display falls back to the filename', () => {
            assertEqual(200, blankSave.status);
            assertEqual(null, blankSave.json.file.title);
            assertEqual(null, blankSave.json.file.description);
        });
    });

    describe('publish', ({ before, it }) => {
        let publishResult;
        let publicGet;
        let publicHead;
        let rangeGet;
        let conditionalGets;
        let staleValidatorGet;
        let listingRows;

        before(async () => {
            publishResult = await postFileAction(rootCookies, csrfToken, original.id, 'publish');

            publicGet = await fetchPathname(null, publicPathname);
            firstEtag = publicGet.response.headers.get('etag');
            publicHead = await fetchPathname(null, publicPathname, { method: 'HEAD' });
            rangeGet = await fetchPathname(null, publicPathname, { headers: { range: 'bytes=0-3' } });

            const weakEtag = `W/${ firstEtag }`;
            const validatorLists = [ firstEtag, weakEtag, `"unrelated", ${ firstEtag }`, '*' ];
            conditionalGets = await Promise.all(validatorLists.map((value) => {
                return fetchPathname(null, publicPathname, { headers: { 'if-none-match': value } });
            }));
            staleValidatorGet = await fetchPathname(null, publicPathname, { headers: { 'if-none-match': '"unrelated"' } });

            listingRows = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);
        });

        it('redirects to the detail page', () => {
            assertEqual(303, publishResult.status);
            assertEqual(`/admin/files/${ original.id }`, publishResult.location);
        });

        it('serves the current bytes with revalidation headers', () => {
            const { headers } = publicGet.response;
            assertEqual(200, publicGet.status);
            assertEqual(FIRST_BODY, publicGet.text);
            assertEqual('text/plain; charset=utf-8', headers.get('content-type'));
            assertEqual(String(original.content.length), headers.get('content-length'));
            assertEqual(`"${ original.content.generation }"`, firstEtag);
            assertEqual('public, no-cache', headers.get('cache-control'));
            assertEqual('nosniff', headers.get('x-content-type-options'));
            assertEqual(`inline; filename="${ originalFilename }"; filename*=UTF-8''${ originalFilename }`,
                headers.get('content-disposition'));
        });

        it('answers HEAD with the same headers and no body', () => {
            assertEqual(200, publicHead.status);
            assertEqual(0, publicHead.bytes.byteLength);
            for (const name of [ 'content-type', 'content-length', 'etag', 'cache-control', 'content-disposition' ]) {
                assertEqual(publicGet.response.headers.get(name), publicHead.response.headers.get(name), name);
            }
        });

        it('ignores Range and serves the full representation', () => {
            assertEqual(200, rangeGet.status);
            assertEqual(FIRST_BODY, rangeGet.text);
            assertEqual(null, rangeGet.response.headers.get('content-range'));
            assertEqual(null, rangeGet.response.headers.get('accept-ranges'));
        });

        it('answers matching, weak, listed, and wildcard validators with a bodyless 304', () => {
            for (const result of conditionalGets) {
                assertEqual(304, result.status);
                assertEqual(0, result.bytes.byteLength);
                assertEqual(firstEtag, result.response.headers.get('etag'));
                assertEqual('public, no-cache', result.response.headers.get('cache-control'));
            }
        });

        it('serves bytes to a non-matching validator', () => {
            assertEqual(200, staleValidatorGet.status);
            assertEqual(FIRST_BODY, staleValidatorGet.text);
        });

        it('shows the file as published in the listing', () => {
            const row = listingRows.find(({ id }) => id === original.id);
            assert(row, 'published file is listed');
            assertEqual(true, row.isPublished);
        });
    });

    describe('metadata edits after publishing', ({ before, it }) => {
        let revalidation;

        before(async () => {
            await postFileAction(rootCookies, csrfToken, original.id, 'metadata', {
                fields: { title: 'Edited after publish', description: '' },
                isPartial: true,
            });
            revalidation = await fetchPathname(null, publicPathname, { headers: { 'if-none-match': firstEtag } });
        });

        it('keep the public validator unchanged', () => {
            assertEqual(304, revalidation.status);
        });
    });

    describe('replacement', ({ before, it }) => {
        let replaceResult;
        let staleRevalidation;
        let listingRows;

        before(async () => {
            replaceResult = await sendUpload(rootCookies, {
                csrfToken,
                fileId: original.id,
                filename: 'e2e-replacement.png',
                body: REPLACEMENT_BODY,
            });
            staleRevalidation = await fetchPathname(null, publicPathname, { headers: { 'if-none-match': firstEtag } });
            replacementEtag = staleRevalidation.response.headers.get('etag');
            listingRows = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);
        });

        it('keeps the identity, metadata, publication state, and upload order', () => {
            const { file } = replaceResult.json;
            assertEqual(200, replaceResult.status);
            assertEqual(original.id, file.id);
            assertEqual('Edited after publish', file.title);
            assertEqual(true, file.isPublished);
            assertEqual(original.originalUploadedAt, file.originalUploadedAt);
            assertEqual(original.meta.sortKey, file.meta.sortKey);
        });

        it('takes the filename, size, and type from the new upload', () => {
            const { content } = replaceResult.json.file;
            assertEqual('e2e-replacement.png', content.filename);
            assertEqual(REPLACEMENT_BODY.byteLength, content.length);
            assertEqual('image/png', content.contentType);
            assert(content.generation !== original.content.generation, 'new content generation');
        });

        it('serves the new bytes to a client holding the old validator', () => {
            const { headers } = staleRevalidation.response;
            assertEqual(200, staleRevalidation.status);
            assertEqual(REPLACEMENT_BODY.join(','), staleRevalidation.bytes.join(','));
            assertEqual(`"${ replaceResult.json.file.content.generation }"`, replacementEtag);
            assertEqual('image/png', headers.get('content-type'));
            assertMatches(/^inline; filename="e2e-replacement\.png"/u, headers.get('content-disposition'));
        });

        it('does not reorder the listing', () => {
            const ids = listingRows.map(({ id }) => id);
            assert(ids.indexOf(duplicate.id) < ids.indexOf(original.id), 'later upload stays ahead of the replaced file');
        });
    });

    describe('failed replacements', ({ before, it }) => {
        let shortBody;
        let longBody;
        let oversize;
        let rejectedCsrf;
        let publicAfter;

        before(async () => {
            const filename = 'e2e-failed-replacement.txt';
            shortBody = await sendUpload(rootCookies, { csrfToken, fileId: original.id, filename, body: 'short', declaredSize: 10 });
            longBody = await sendUpload(rootCookies, { csrfToken, fileId: original.id, filename, body: 'too long', declaredSize: 3 });
            oversize = await sendUpload(rootCookies, {
                csrfToken,
                fileId: original.id,
                filename,
                body: 'x',
                declaredSize: maxUploadBytes + 1,
            });
            rejectedCsrf = await sendUpload(rootCookies, { csrfToken: null, fileId: original.id, filename, body: 'x' });
            publicAfter = await fetchPathname(null, publicPathname);
        });

        it('reject a body that does not match its declared size', () => {
            assertEqual(400, shortBody.status);
            assertEqual('FileContentLengthMismatch', shortBody.json?.error?.code);
            assertEqual(400, longBody.status);
            assertEqual('FileContentLengthMismatch', longBody.json?.error?.code);
        });

        it('reject a declared size above the configured limit', () => {
            assertEqual(413, oversize.status);
            assertEqual('FileUploadTooLarge', oversize.json?.error?.code);
        });

        it('reject a replacement without a CSRF token', () => {
            assertEqual(403, rejectedCsrf.status);
        });

        it('keep serving the current content and validator', () => {
            assertEqual(200, publicAfter.status);
            assertEqual(REPLACEMENT_BODY.join(','), publicAfter.bytes.join(','));
            assertEqual(replacementEtag, publicAfter.response.headers.get('etag'));
        });
    });

    describe('unpublish and republish', ({ before, it }) => {
        let unpublishResult;
        let unpublishedGet;
        let unpublishedRevalidation;
        let republishResult;
        let republishedGet;

        before(async () => {
            unpublishResult = await postFileAction(rootCookies, csrfToken, original.id, 'unpublish', { isPartial: true });
            unpublishedGet = await fetchPathname(null, publicPathname);
            unpublishedRevalidation = await fetchPathname(null, publicPathname, {
                headers: { 'if-none-match': replacementEtag },
            });

            republishResult = await postFileAction(rootCookies, csrfToken, original.id, 'publish', { isPartial: true });
            republishedGet = await fetchPathname(null, publicPathname);
        });

        it('unpublishes immediately', () => {
            assertEqual(200, unpublishResult.status);
            assertEqual(false, unpublishResult.json.file.isPublished);
            assertEqual(404, unpublishedGet.status);
            assertEqual('no-store', unpublishedGet.response.headers.get('cache-control'));
        });

        it('never answers a validator issued before unpublishing with 304', () => {
            assertEqual(404, unpublishedRevalidation.status);
        });

        it('republishes at the original pathname', () => {
            assertEqual(200, republishResult.status);
            assertEqual(publicPathname, republishResult.json.links.public);
            assertEqual(200, republishedGet.status);
            assertEqual(replacementEtag, republishedGet.response.headers.get('etag'));
        });
    });

    describe('deletion', ({ before, it }) => {
        let publishedDelete;
        let publicAfterRejectedDelete;
        let unconfirmedDelete;
        let detailAfterUnconfirmedDelete;
        let deleteResult;
        let detailAfterDelete;
        let downloadAfterDelete;
        let publicAfterDelete;
        let republishAfterDelete;

        before(async () => {
            publishedDelete = await postFileAction(rootCookies, csrfToken, original.id, 'delete', {
                fields: { confirm_delete: 'yes' },
                isPartial: true,
            });
            publicAfterRejectedDelete = await fetchPathname(null, publicPathname);

            await postFileAction(rootCookies, csrfToken, original.id, 'unpublish', { isPartial: true });

            unconfirmedDelete = await postFileAction(rootCookies, csrfToken, original.id, 'delete', { isPartial: true });
            detailAfterUnconfirmedDelete = await fetchPathname(rootCookies, `/admin/files/${ original.id }`);

            deleteResult = await postFileAction(rootCookies, csrfToken, original.id, 'delete', {
                fields: { confirm_delete: 'yes' },
            });

            detailAfterDelete = await fetchPathname(rootCookies, `/admin/files/${ original.id }`);
            downloadAfterDelete = await fetchPathname(rootCookies, `/admin/files/${ original.id }/download`);
            publicAfterDelete = await fetchPathname(null, publicPathname);
            republishAfterDelete = await postFileAction(rootCookies, csrfToken, original.id, 'publish', { isPartial: true });
        });

        it('refuses to delete a published file', () => {
            assertEqual(409, publishedDelete.status);
            assertEqual('PublishedFileDeleteConflict', publishedDelete.json?.error?.code);
            assertEqual(200, publicAfterRejectedDelete.status);
        });

        it('refuses a deletion the operator did not confirm', () => {
            assertEqual(400, unconfirmedDelete.status);
            assertEqual('FileDeleteNotConfirmed', unconfirmedDelete.json?.error?.code);
            assertEqual(200, detailAfterUnconfirmedDelete.status);
        });

        it('deletes an unpublished file and returns to the listing', () => {
            assertEqual(303, deleteResult.status);
            assertEqual('/admin/files', deleteResult.location);
        });

        it('removes the identity from every surface', () => {
            assertEqual(404, detailAfterDelete.status);
            assertEqual(404, downloadAfterDelete.status);
            assertEqual(404, publicAfterDelete.status);
        });

        it('cannot resurrect a deleted identity', () => {
            assertEqual(404, republishAfterDelete.status);
            assertEqual('FileNotFound', republishAfterDelete.json?.error?.code);
        });
    });
});
