import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { FastHTMLParser } from 'fast-html-dom-parser';
import { loginRootAdmin } from '../test-helpers/admin-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import {
    createPublishingApiToken,
    createReleaseOrThrow,
    getBuild,
    getDiscovery,
    putBuild,
    uploadObject,
} from '../test-helpers/publishing-workflows.js';
import { createRunPrefix, createRunScopedPathname } from './helpers.js';

const IS_DEVELOPMENT_TARGET = process.env.E2E_TESTS_TARGET === 'development';
const RUN_PREFIX = createRunPrefix();

describe('Admin publishing assignment identities', ({ before, after, it }) => {
    let publishingToken;
    let buildId;
    let originalReleaseId;
    let ownedPointer;
    let originalAssignmentId;
    let overviewForm;
    let detailForm;
    let overviewResult;
    let detailResult;
    let finalPointer;

    // Restore only from a successful API result owned by this test, never by
    // replacing its identity with the latest pointer observed during cleanup.
    after(async () => {
        if (ownedPointer && ownedPointer.releaseId !== originalReleaseId) {
            const restored = await putBuild(publishingToken, buildId, {
                releaseId: originalReleaseId,
                expectedAssignmentId: ownedPointer.assignmentId,
                reason: 'restore',
            });
            assertEqual(200, restored.status, 'Conditional admin-workflow restoration failed');
        }
    });

    before(async () => {
        const token = await createPublishingApiToken({ description: `${ RUN_PREFIX } admin identity` });
        publishingToken = token.token;
        const discovery = await getDiscovery(publishingToken);
        buildId = discovery.body.data.attributes.runningBuildId;
        const initial = await getBuild(publishingToken, buildId);
        assertEqual(200, initial.status, 'Admin assignment requires an already seeded running build');
        originalReleaseId = initial.body.data.attributes.releaseId;
        originalAssignmentId = initial.body.data.attributes.assignmentId;

        const object = await uploadObject(publishingToken, `${ RUN_PREFIX } admin target`);
        const target = await createReleaseOrThrow(publishingToken, {
            staticAssets: { [createRunScopedPathname(RUN_PREFIX, 'admin.txt')]: { objectId: object.objectId, size: object.size } },
        });
        const cookies = await loginRootAdmin();
        overviewForm = await readAssignForm('/admin/publishing', cookies, target.id);
        detailForm = await readAssignForm(`/admin/publishing/releases/${ target.id }`, cookies, target.id);

        const forward = await putBuild(publishingToken, buildId, {
            releaseId: target.id, expectedAssignmentId: originalAssignmentId, reason: 'publish',
        });
        assertEqual(200, forward.status);
        ownedPointer = forward.body.data.attributes;
        const rollback = await putBuild(publishingToken, buildId, {
            releaseId: originalReleaseId, expectedAssignmentId: ownedPointer.assignmentId, reason: 'restore',
        });
        assertEqual(200, rollback.status);
        ownedPointer = rollback.body.data.attributes;

        overviewResult = await submitAssignForm(overviewForm, cookies);
        detailResult = await submitAssignForm(detailForm, cookies);
        finalPointer = await getBuild(publishingToken, buildId);
    });

    it('renders the observed assignment identity in both forms', () => {
        assertEqual(originalAssignmentId, overviewForm.get('expected_assignment_id'));
        assertEqual(originalAssignmentId, detailForm.get('expected_assignment_id'));
        assertEqual(null, overviewForm.get('expected_release_id'));
        assertEqual(null, detailForm.get('expected_release_id'));
    });

    it('redirects stale overview and detail submissions to the conflict notice', () => {
        for (const response of [ overviewResult, detailResult ]) {
            assertEqual(303, response.status);
            assert(response.headers.get('location').endsWith('/admin/publishing?notice=pointer_conflict'));
        }
    });

    it('leaves the restored pointer and identity untouched', () => {
        assertEqual(200, finalPointer.status);
        assertEqual(originalReleaseId, finalPointer.body.data.attributes.releaseId);
        assertEqual(ownedPointer.assignmentId, finalPointer.body.data.attributes.assignmentId);
        assert(originalAssignmentId !== ownedPointer.assignmentId);
    });
}, { disabled: IS_DEVELOPMENT_TARGET });

async function readAssignForm(pathname, cookies, releaseId) {
    const response = await fetch(`${ getBaseUrl() }${ pathname }`, {
        headers: { cookie: cookies.cookieHeader() }, redirect: 'manual',
    });
    cookies.applyResponse(response);
    assertEqual(200, response.status);
    const document = new FastHTMLParser(await response.text());
    const data = new FormData();
    for (const name of [ 'csrf_token', 'build_id', 'expected_assignment_id' ]) {
        const [ field ] = document.getElementsByName(name);
        assert(field, `Missing ${ name } in ${ pathname }`);
        data.set(name, field.getAttribute('value'));
    }
    const targets = document.getElementsByName('release_id');
    assert(targets.some((field) => field.getAttribute('value') === releaseId));
    data.set('release_id', releaseId);
    return data;
}

async function submitAssignForm(data, cookies) {
    return await fetch(`${ getBaseUrl() }/admin/publishing/assign`, {
        method: 'POST', headers: { cookie: cookies.cookieHeader() }, body: data, redirect: 'manual',
    });
}
