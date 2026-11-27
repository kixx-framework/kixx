/**
 * A publish through the Publishing API, as a client outside development
 * makes one (protocol 4): discovery, an upload, a Release, an assignment to
 * the running build, and the Activation it leaves in the build's history.
 */
import { describe } from 'kixx-test';
import { assert, assertEqual, isNonEmptyString } from 'kixx-assert';
import { fetchWithDeployKey, getBaseUrl } from '../test-helpers/target.js';
import { ensurePublished, publishTestAppContent } from '../test-helpers/publish.js';


const API = '/publishing-api/v1';

// A file no other run has published, so this run's Release is new: there is
// an object to upload, and the assignment changes the build's pointer.
const RUN_ID = `${ Date.now() }-${ crypto.randomUUID() }`;
const RUN_FILE_PATHNAME = '/integration-publishing-api.txt';
const RUN_FILES = { 'public/integration-publishing-api.txt': `${ RUN_ID }\n` };


describe('publishing API', ({ before, it }) => {
    let staged;
    let published;

    before(async () => {
        // The build is staged before this file's own publish, whichever
        // file runs first.
        staged = await ensurePublished();
        published = await publishTestAppContent(RUN_FILES);
    });

    it('reports protocol 4 and the build the target runs', async () => {
        const { attributes } = (await getDocument(`${ API }/`)).data;

        assertEqual(4, attributes.buildAssignmentProtocolVersion);
        assertEqual(2, attributes.contentContractVersion);
        assertEqual(4, attributes.addressingFormat);
        assert(isNonEmptyString(attributes.runningBuildId), 'expected a running build id');

        const environment = await getDocument('/integration-probe/environment');

        assertEqual(environment.buildId, attributes.runningBuildId);
        assertEqual(attributes.runningBuildId, published.buildId);
    });

    it('uploads the objects the store lacks', () => {
        assert(published.uploaded >= 1, 'expected the run\'s own file to be uploaded');
    });

    it('creates a Release that can be read back', async () => {
        assert(isNonEmptyString(published.releaseId), 'expected a Release id');

        const release = await getDocument(`${ API }/releases/${ encodeURIComponent(published.releaseId) }`);

        assertEqual('Release', release.data.type);
        assertEqual(published.releaseId, release.data.id);
    });

    it('assigns the Release to the running build as a content-only publish', async () => {
        assertEqual('publish', published.intent);

        const build = await getDocument(`${ API }/builds/${ encodeURIComponent(published.buildId) }`);

        assertEqual(published.releaseId, build.data.attributes.releaseId);
        assertEqual(published.assignmentId, build.data.attributes.assignmentId);
    });

    it('serves the published file at once', async () => {
        const response = await fetch(`${ getBaseUrl() }${ RUN_FILE_PATHNAME }`, { redirect: 'manual' });

        assertEqual(200, response.status);
        assertEqual(`${ RUN_ID }\n`, await response.text());
    });

    it('lists the Activation in the build\'s history, newest first', async () => {
        const history = await getDocument(`${ API }/builds/${ encodeURIComponent(published.buildId) }/activations`);

        const activation = history.data.find(({ attributes }) => attributes.assignmentId === published.assignmentId);

        assert(activation, 'the assignment just made is not in the history');
        assertEqual('Activation', activation.type);
        assertEqual(published.releaseId, activation.attributes.toReleaseId);
        assertEqual('publish', activation.attributes.reason);
        assertEqual('deploy-key', activation.attributes.actor.type);
        assert(isNonEmptyString(activation.attributes.fromReleaseId), 'expected the Release it replaced');

        // The build was staged first, so its first assignment is older.
        const stagedAt = history.data.findIndex(({ attributes }) => attributes.assignmentId === staged.assignmentId);
        const publishedAt = history.data.indexOf(activation);

        if (stagedAt !== -1) {
            assert(publishedAt < stagedAt, 'expected the newer Activation first');
        }
    });
});


async function getDocument(pathname) {
    const response = await fetchWithDeployKey(pathname);

    assertEqual(200, response.status, `GET ${ pathname }`);

    return response.json();
}
