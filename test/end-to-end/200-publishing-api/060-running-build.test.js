import process from 'node:process';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import {
    createPublishingApiToken,
    createReleaseOrThrow,
    getBuild,
    getDiscovery,
    listBuildActivations,
    putBuild,
    uploadObject,
} from '../test-helpers/publishing-workflows.js';
import { createRunPrefix, createRunScopedPathname } from './helpers.js';


const IS_DEVELOPMENT_TARGET = process.env.E2E_TESTS_TARGET === 'development';
const RUN_PREFIX = createRunPrefix();

let publishingToken;
let runningBuildId;
// Captured before any mutation so the `after` hook can restore the exact
// pointer this run observed, even if setup fails partway through (kixx-test
// always runs `after` hooks for a describe even when its `before` fails).
let originalReleaseId;
let newRelease;
let assignResponse;
let readBackResponse;
let activationsResponse;


describe('Publishing API running-build publish workflow', ({ before, after, it }) => {

    after(async () => {
        if (!publishingToken || !runningBuildId || !newRelease || assignResponse?.status !== 200 || !originalReleaseId) {
            return;
        }

        const restoreResponse = await putBuild(publishingToken, runningBuildId, {
            releaseId: originalReleaseId,
            ifMatch: newRelease.id,
            reason: 'restore',
        });
        if (restoreResponse.status !== 200) {
            throw new Error(
                `Failed to restore build "${ runningBuildId }" to Release "${ originalReleaseId }": ` +
                `${ restoreResponse.status } ${ JSON.stringify(restoreResponse.body) }`,
            );
        }
    });

    before(async () => {
        const token = await createPublishingApiToken({ description: `${ RUN_PREFIX } running build workflow` });
        publishingToken = token.token;

        const discovery = await getDiscovery(publishingToken);
        runningBuildId = discovery.body.data.attributes.runningBuildId;
        if (!runningBuildId) {
            throw new Error('Publishing API discovery reports no running build id; this workflow cannot run.');
        }

        const pointerResponse = await getBuild(publishingToken, runningBuildId);
        const object = await uploadObject(publishingToken, `${ RUN_PREFIX } running build content`);
        newRelease = await createReleaseOrThrow(publishingToken, {
            staticAssets: {
                [createRunScopedPathname(RUN_PREFIX, 'running-build.css')]: { objectId: object.objectId, size: object.size },
            },
        });

        if (pointerResponse.status === 200) {
            originalReleaseId = pointerResponse.body.data.attributes.releaseId;
            assignResponse = await putBuild(publishingToken, runningBuildId, {
                releaseId: newRelease.id,
                ifMatch: originalReleaseId,
                reason: 'publish',
            });
        } else if (pointerResponse.status === 404) {
            // A genuinely fresh deploy with nothing assigned yet: this is a
            // one-way bootstrap, not a publish, and there is no prior pointer
            // to restore in `after`.
            originalReleaseId = null;
            assignResponse = await putBuild(publishingToken, runningBuildId, {
                releaseId: newRelease.id,
                ifNoneMatch: '*',
                reason: 'publish',
            });
        } else {
            throw new Error(
                `GET /builds/${ runningBuildId } returned ${ pointerResponse.status }, expected 200 or 404`,
            );
        }

        readBackResponse = await getBuild(publishingToken, runningBuildId);
        activationsResponse = await listBuildActivations(publishingToken, runningBuildId);
    });

    it('assigns a new Release to the running build with If-Match', () => {
        assertEqual(200, assignResponse.status);
        assertEqual(newRelease.id, assignResponse.body.data.attributes.releaseId);
    });

    it('reads the newly assigned Release back from the running build', () => {
        assertEqual(200, readBackResponse.status);
        assertEqual(newRelease.id, readBackResponse.body.data.attributes.releaseId);
        assertEqual(`"${ newRelease.id }"`, readBackResponse.headers.get('etag'));
    });

    it('records the assignment in the running build activation history', () => {
        assertEqual(200, activationsResponse.status);
        const latest = activationsResponse.body.data[0];
        assertEqual(newRelease.id, latest.attributes.toReleaseId);
        assertEqual('publish', latest.attributes.reason);
    });
}, { disabled: IS_DEVELOPMENT_TARGET });
