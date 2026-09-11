import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import {
    FileFixtures,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    openUploadPage,
    postFileAction,
    sendUpload,
} from './helpers.js';


// Extension, expected Content-Type, expected disposition, and an optional
// browser MIME claim the server must ignore.
const DISPOSITION_CASES = [
    { extension: 'png', contentType: 'image/png', disposition: 'inline' },
    { extension: 'pdf', contentType: 'application/pdf', disposition: 'inline' },
    { extension: 'mp3', contentType: 'audio/mpeg', disposition: 'inline' },
    { extension: 'mp4', contentType: 'video/mp4', disposition: 'inline' },
    { extension: 'txt', contentType: 'text/plain; charset=utf-8', disposition: 'inline', claimed: 'text/html' },
    { extension: 'html', contentType: 'text/html; charset=utf-8', disposition: 'attachment', claimed: 'text/plain' },
    { extension: 'svg', contentType: 'image/svg+xml; charset=utf-8', disposition: 'attachment', claimed: 'image/png' },
    { extension: 'xml', contentType: 'application/xml; charset=utf-8', disposition: 'attachment' },
    { extension: 'e2eunknown', contentType: 'application/octet-stream', disposition: 'attachment' },
];

let rootCookies;
let uploadPage;
let fixtures;


describe('Admin file content policy', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();
        uploadPage = await openUploadPage(rootCookies);
        fixtures = new FileFixtures(rootCookies, uploadPage.csrfToken);
    });

    after(async () => {
        await fixtures?.cleanup();
    });

    describe('public disposition', ({ before, it }) => {
        let results;

        before(async () => {
            results = await Promise.all(DISPOSITION_CASES.map(async (testCase) => {
                const filename = createFixtureFilename('disposition', testCase.extension);
                const upload = await sendUpload(rootCookies, {
                    csrfToken: uploadPage.csrfToken,
                    filename,
                    body: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg> ${ testCase.extension }`,
                    contentType: testCase.claimed,
                });
                assertEqual(201, upload.status, `upload .${ testCase.extension }`);
                fixtures.track(upload.json.file.id);

                await postFileAction(rootCookies, uploadPage.csrfToken, upload.json.file.id, 'publish', { isPartial: true });
                const served = await fetchPathname(null, `/files/${ upload.json.file.id }`);
                const download = await fetchPathname(rootCookies, `/admin/files/${ upload.json.file.id }/download`, {
                    method: 'HEAD',
                });

                return { testCase, filename, served, download };
            }));
        });

        it('derives the content type from the extension, ignoring the browser claim', () => {
            for (const { testCase, served } of results) {
                assertEqual(200, served.status, testCase.extension);
                assertEqual(testCase.contentType, served.response.headers.get('content-type'), testCase.extension);
            }
        });

        it('serves browser media and plain text inline, and markup and unknown types as attachments', () => {
            for (const { testCase, filename, served } of results) {
                assertEqual(
                    `${ testCase.disposition }; filename="${ filename }"; filename*=UTF-8''${ filename }`,
                    served.response.headers.get('content-disposition'),
                    testCase.extension,
                );
            }
        });

        it('forbids MIME sniffing on every public response', () => {
            for (const { testCase, served } of results) {
                assertEqual('nosniff', served.response.headers.get('x-content-type-options'), testCase.extension);
            }
        });

        it('forces every admin download to an attachment', () => {
            for (const { testCase, download } of results) {
                assertMatches(/^attachment; /u, download.response.headers.get('content-disposition'), testCase.extension);
                assertEqual('private, no-store', download.response.headers.get('cache-control'), testCase.extension);
            }
        });
    });

    describe('zero-byte files', ({ before, it }) => {
        let upload;
        let served;
        let head;
        let download;

        before(async () => {
            upload = await sendUpload(rootCookies, {
                csrfToken: uploadPage.csrfToken,
                filename: createFixtureFilename('empty', 'txt'),
                body: new Uint8Array(0),
            });
            fixtures.track(upload.json?.file?.id);

            await postFileAction(rootCookies, uploadPage.csrfToken, upload.json.file.id, 'publish', { isPartial: true });
            served = await fetchPathname(null, `/files/${ upload.json.file.id }`);
            head = await fetchPathname(null, `/files/${ upload.json.file.id }`, { method: 'HEAD' });
            download = await fetchPathname(rootCookies, `/admin/files/${ upload.json.file.id }/download`);
        });

        it('accepts an empty upload', () => {
            assertEqual(201, upload.status);
            assertEqual(0, upload.json.file.content.length);
        });

        it('serves an empty public body with a zero length', () => {
            assertEqual(200, served.status);
            assertEqual(0, served.bytes.byteLength);
            assertEqual('0', served.response.headers.get('content-length'));
            assertEqual('0', head.response.headers.get('content-length'));
        });

        it('downloads an empty body', () => {
            assertEqual(200, download.status);
            assertEqual(0, download.bytes.byteLength);
        });
    });

    describe('filenames', ({ before, it }) => {
        let unicode;
        let unicodeDownload;
        let pathSegments;
        let controlCharacters;
        let badEncoding;

        before(async () => {
            unicode = await sendUpload(rootCookies, {
                csrfToken: uploadPage.csrfToken,
                filename: 'résumé ✓ "quoted".txt',
                body: 'unicode filename',
            });
            fixtures.track(unicode.json?.file?.id);
            unicodeDownload = await fetchPathname(rootCookies, `/admin/files/${ unicode.json.file.id }/download`, {
                method: 'HEAD',
            });

            pathSegments = await sendUpload(rootCookies, {
                csrfToken: uploadPage.csrfToken,
                filename: '../nested\\dir/e2e-basename.txt',
                body: 'basename only',
            });
            fixtures.track(pathSegments.json?.file?.id);

            controlCharacters = await sendUpload(rootCookies, {
                csrfToken: uploadPage.csrfToken,
                filename: 'e2e-header\r\nset-cookie: injected=1.txt',
                body: 'must never be stored',
            });

            // A truncated percent escape cannot be decoded.
            badEncoding = await sendUpload(rootCookies, {
                csrfToken: uploadPage.csrfToken,
                filename: 'placeholder.txt',
                body: 'must never be stored',
                headers: { 'x-file-name': 'bad%E0%A4%A.txt' },
            });
        });

        it('keeps a Unicode filename and encodes it safely for the header', () => {
            assertEqual(201, unicode.status);
            assertEqual('résumé ✓ "quoted".txt', unicode.json.file.content.filename);
            assertEqual(
                'attachment; filename="r_sum_ _ _quoted_.txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20%E2%9C%93%20%22quoted%22.txt',
                unicodeDownload.response.headers.get('content-disposition'),
            );
        });

        it('stores only the basename of a path-like filename', () => {
            assertEqual(201, pathSegments.status);
            assertEqual('e2e-basename.txt', pathSegments.json.file.content.filename);
        });

        it('rejects control characters without storing a file', () => {
            assertEqual(422, controlCharacters.status);
            assertEqual(undefined, controlCharacters.json?.file);
        });

        it('rejects an undecodable filename header', () => {
            assertEqual(400, badEncoding.status);
            assertEqual('InvalidFileNameEncoding', badEncoding.json?.error?.code);
        });
    });

    describe('upload validation', ({ before, it }) => {
        let rowsBefore;
        let rowsAfter;
        let oversize;
        let shortBody;
        let longBody;
        let missingSize;
        let invalidSize;

        before(async () => {
            rowsBefore = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);

            const base = { csrfToken: uploadPage.csrfToken, filename: createFixtureFilename('invalid', 'txt') };

            // The declared size alone exceeds the limit, so the server rejects
            // it before reading the one-byte body.
            oversize = await sendUpload(rootCookies, Object.assign({
                body: 'x',
                declaredSize: uploadPage.maxUploadBytes + 1,
            }, base));
            shortBody = await sendUpload(rootCookies, Object.assign({ body: 'short', declaredSize: 6 }, base));
            longBody = await sendUpload(rootCookies, Object.assign({ body: 'longer', declaredSize: 5 }, base));
            missingSize = await sendUpload(rootCookies, Object.assign({ body: 'x', declaredSize: null }, base));
            invalidSize = await sendUpload(rootCookies, Object.assign({ body: 'x', declaredSize: 'one' }, base));

            rowsAfter = getListingRows((await fetchPathname(rootCookies, '/admin/files')).text);
        });

        it('rejects a declared size above the configured limit with 413', () => {
            assertEqual(413, oversize.status);
            assertEqual('FileUploadTooLarge', oversize.json?.error?.code);
        });

        it('rejects bodies that end early or run past the declared size', () => {
            assertEqual(400, shortBody.status);
            assertEqual('FileContentLengthMismatch', shortBody.json?.error?.code);
            assertEqual(400, longBody.status);
            assertEqual('FileContentLengthMismatch', longBody.json?.error?.code);
        });

        it('requires a nonnegative integer declared size', () => {
            assertEqual(422, missingSize.status);
            assertEqual(422, invalidSize.status);
        });

        it('creates no file for a rejected upload', () => {
            assertEqual(
                rowsBefore.map(({ id }) => id).join(','),
                rowsAfter.map(({ id }) => id).join(','),
            );
            assert(rowsAfter.length === rowsBefore.length, 'listing unchanged');
        });
    });
});
