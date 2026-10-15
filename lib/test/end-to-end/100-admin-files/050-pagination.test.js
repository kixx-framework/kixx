import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import validateHtml from '../test-helpers/validate-html.js';
import {
    FileFixtures,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    getPaginationHref,
    openUploadPage,
} from './helpers.js';


const PAGE_SIZE = 25;
const FIXTURE_COUNT = PAGE_SIZE + 1;

let rootCookies;
let fixtures;

// Fixture ids in upload order, oldest first.
const uploadedIds = [];


describe('Admin file listing pagination', ({ before, after, it }) => {
    let firstPage;
    let firstPageRows;
    let nextHref;
    let secondPage;
    let secondPageRows;
    let previousHref;
    let previousPage;
    let invalidCursor;

    before(async () => {
        rootCookies = await loginRootAdmin();
        const { csrfToken } = await openUploadPage(rootCookies);
        fixtures = new FileFixtures(rootCookies, csrfToken);
    });

    // Uploads run one at a time so each gets a later original-upload key than
    // the one before it. They are split across hooks to stay inside the
    // per-hook timeout against a remote target.
    [ 0, 9, 18 ].forEach((start) => {
        before(async () => {
            const end = Math.min(start + 9, FIXTURE_COUNT);
            for (let index = start; index < end; index += 1) {
                // eslint-disable-next-line no-await-in-loop
                const file = await fixtures.upload(createFixtureFilename(`page-${ index }`, 'txt'), `fixture ${ index }`);
                uploadedIds.push(file.id);
            }
        });
    });

    before(async () => {
        firstPage = await fetchPathname(rootCookies, '/admin/files');
        firstPageRows = getListingRows(firstPage.text);
        nextHref = getPaginationHref(firstPage.text, 'Next page');

        secondPage = await fetchPathname(rootCookies, nextHref);
        secondPageRows = getListingRows(secondPage.text);
        previousHref = getPaginationHref(secondPage.text, 'Previous page');

        previousPage = await fetchPathname(rootCookies, previousHref);
        invalidCursor = await fetchPathname(rootCookies, '/admin/files?cursor=not-a-signed-cursor');
    });

    after(async () => {
        await fixtures?.cleanup();
    });

    it('renders a page of 25 files, newest original upload first', async () => {
        assertEqual(200, firstPage.status);
        await validateHtml(firstPage.text);

        const newestFirst = uploadedIds.slice(1).reverse();
        assertEqual(PAGE_SIZE, firstPageRows.length);
        assertEqual(newestFirst.join(','), firstPageRows.map(({ id }) => id).join(','));
    });

    it('continues with the oldest fixture on the next page', () => {
        assert(nextHref, 'first page has a next page link');
        assertEqual(200, secondPage.status);
        assertEqual(uploadedIds[0], secondPageRows[0]?.id);
    });

    it('links back to the first page', () => {
        assert(previousHref, 'second page has a previous page link');
        assertEqual(
            firstPageRows.map(({ id }) => id).join(','),
            getListingRows(previousPage.text).map(({ id }) => id).join(','),
        );
    });

    it('rejects a forged cursor', () => {
        assertEqual(400, invalidCursor.status);
    });
});
