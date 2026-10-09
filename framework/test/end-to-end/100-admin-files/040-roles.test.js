import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { createInvitedAdmin, loginRootAdmin } from '../test-helpers/admin-workflows.js';
import {
    FileFixtures,
    createFixtureFilename,
    fetchPathname,
    getListingRows,
    openUploadPage,
    postFileAction,
    sendUpload,
} from './helpers.js';


// Root Admin is covered by the lifecycle suite through its wildcard grant.
const ROLE_IDS = [ 'developer', 'admin', 'editor' ];

let rootCookies;
let rootFixtures;
let sharedFile;


describe('Admin file roles', ({ before, after, describe }) => {

    before(async () => {
        rootCookies = await loginRootAdmin();
        const { csrfToken } = await openUploadPage(rootCookies);
        rootFixtures = new FileFixtures(rootCookies, csrfToken);

        // Uploaded by Root Admin and edited by every other role: the library
        // is shared, with no uploader ownership restriction.
        sharedFile = await rootFixtures.upload(createFixtureFilename('shared', 'txt'), 'shared library file');
    });

    after(async () => {
        await rootFixtures?.cleanup();
    });

    ROLE_IDS.forEach((roleId) => {
        describe(`${ roleId } role`, ({ before, after, it }) => {
            let cookies;
            let fixtures;
            let listing;
            let upload;
            let metadata;
            let publish;
            let served;
            let unpublish;
            let deletion;
            let sharedEdit;

            before(async () => {
                cookies = await createInvitedAdmin(rootCookies, { roleId });
                const { csrfToken } = await openUploadPage(cookies);
                fixtures = new FileFixtures(cookies, csrfToken);

                listing = await fetchPathname(cookies, '/admin/files');

                upload = await sendUpload(cookies, {
                    csrfToken,
                    filename: createFixtureFilename(roleId, 'txt'),
                    body: `${ roleId } upload`,
                });
                const fileId = upload.json?.file?.id;
                fixtures.track(fileId);

                metadata = await postFileAction(cookies, csrfToken, fileId, 'metadata', {
                    fields: { title: `${ roleId } title`, description: '' },
                    isPartial: true,
                });
                publish = await postFileAction(cookies, csrfToken, fileId, 'publish', { isPartial: true });
                served = await fetchPathname(null, `/files/${ fileId }`);
                unpublish = await postFileAction(cookies, csrfToken, fileId, 'unpublish', { isPartial: true });
                deletion = await postFileAction(cookies, csrfToken, fileId, 'delete', {
                    fields: { confirm_delete: 'yes' },
                    isPartial: true,
                });

                sharedEdit = await postFileAction(cookies, csrfToken, sharedFile.id, 'metadata', {
                    fields: { title: `Edited by ${ roleId }`, description: '' },
                    isPartial: true,
                });
            });

            after(async () => {
                await fixtures?.cleanup();
            });

            it('lists the shared library, including files others uploaded', () => {
                assertEqual(200, listing.status);
                const ids = getListingRows(listing.text).map(({ id }) => id);
                assertEqual(true, ids.includes(sharedFile.id));
            });

            it('uploads, edits, publishes, unpublishes, and deletes a file', () => {
                assertEqual(201, upload.status);
                assertEqual(200, metadata.status);
                assertEqual(`${ roleId } title`, metadata.json.file.title);
                assertEqual(200, publish.status);
                assertEqual(200, served.status);
                assertEqual(`${ roleId } upload`, served.text);
                assertEqual(200, unpublish.status);
                assertEqual(200, deletion.status);
                assertEqual(true, deletion.json.deleted);
            });

            it('manages a file another admin uploaded', () => {
                assertEqual(200, sharedEdit.status);
                assertEqual(`Edited by ${ roleId }`, sharedEdit.json.file.title);
            });
        });
    });
});
