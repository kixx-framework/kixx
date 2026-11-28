import { describe } from 'kixx-test';
import { assert, assertEqual, isString } from '../../lib/vendor/kixx-assert/mod.js';
import loadProjectTooling from '../../lib/project/load-project-tooling.js';
import publishContent from '../../lib/publishing/publish-content.js';
import { BUILD_ASSIGNMENT_PROTOCOL_VERSION } from '../../lib/publishing/negotiate-capabilities.js';
import { buildProject, removeProject } from './built-project.js';
// Conformance tests may read core. These are what a server built from this
// repository reports and accepts.
import { FORMAT } from '../../../kixx/content-addressable-store/addressing.js';
import { CONTENT_CONTRACT_VERSION } from '../../../kixx/content-addressable-store/content-addressable-store.js';
import { validateReleaseManifest } from '../../../kixx/content-addressable-store/release-manifest.js';
import {
    BUILD_ASSIGNMENT_PROTOCOL_VERSION as CORE_BUILD_ASSIGNMENT_PROTOCOL_VERSION,
    MAX_MANIFEST_ENTRIES,
    MAX_OBJECT_BYTES,
    MAX_OBJECT_STATUS_IDS,
} from '../../../kixx/publishing-api/constants.js';


// Copying the skeleton and core, and importing core, takes longer than the
// 1000ms default on a busy machine.
const TIMEOUT = { timeout: 20000 };

// The publishing pipeline against the real content compiler, loaded from a
// real project as a command would load it. The devkit composes nothing: it
// sends what the project's compiler made.
describe('publish pipeline conformance with core', ({ before, after, it }) => {
    let projectDirectory;
    let loaded;
    let compilation;

    before(async () => {
        projectDirectory = await buildProject();
        loaded = await loadProjectTooling(projectDirectory);

        compilation = await loaded.tooling.compileProjectContent({
            fileSystem: loaded.createProjectFileSystem(projectDirectory),
            source: loaded.createFileSystemContentSource(projectDirectory),
        });
    }, TIMEOUT);

    after(async () => {
        await removeProject(projectDirectory);
    });

    it('takes the content contract from the project\'s tooling', () => {
        assertEqual(CONTENT_CONTRACT_VERSION, loaded.tooling.CONTENT_CONTRACT_VERSION);
        assertEqual(FORMAT, loaded.tooling.ADDRESSING_FORMAT);
    });

    function publish(client, options) {
        return publishContent({
            client,
            compilation,
            serializeContentObject: loaded.tooling.serializeContentObject,
            // The devkit holds neither value: it takes both from the
            // project's Kixx, as a command does.
            expected: {
                contentContractVersion: loaded.tooling.CONTENT_CONTRACT_VERSION,
                addressingFormat: loaded.tooling.ADDRESSING_FORMAT,
            },
            ...options,
        });
    }

    it('speaks the build assignment protocol core serves', () => {
        assertEqual(CORE_BUILD_ASSIGNMENT_PROTOCOL_VERSION, BUILD_ASSIGNMENT_PROTOCOL_VERSION);
    });

    it('compiles the skeleton\'s content with no problems', () => {
        assertEqual('', compilation.report.problems.map(({ message }) => message).join('\n'));
        assert(compilation.release, 'the compilation has a Release');
        assert(compilation.objects.length > 0, 'the skeleton has content');
    });

    it('sends the compiler\'s manifest, which core accepts', async () => {
        const client = makeClient();

        const result = await publish(client);

        assertEqual(true, result.created);
        assertEqual(1, client.releases.length);
        assert(client.releases[0].manifest === compilation.release.manifest, 'sends release.manifest');

        const files = validateReleaseManifest(client.releases[0].manifest);

        assertEqual(compilation.objects.length, files.length);
    });

    it('uploads each object once, with the serializer\'s bytes at the manifest\'s size', async () => {
        const client = makeClient();

        await publish(client);

        const sizes = new Map(validateReleaseManifest(compilation.release.manifest).map((file) => {
            return [ file.hash, file.size ];
        }));
        const objects = new Map(compilation.objects.map((object) => [ object.hash, object ]));

        assertEqual(objects.size, client.uploads.length);
        assertEqual(
            [ ...objects.keys() ].toSorted().join('\n'),
            client.uploads.map(({ objectId }) => objectId).toSorted().join('\n'),
        );

        for (const { objectId, body } of client.uploads) {
            const expected = loaded.tooling.serializeContentObject(objects.get(objectId));

            assertEqual(getByteLength(expected), getByteLength(body), `the bytes of ${ objectId }`);
            assert(isString(body) ? body === expected : body instanceof ArrayBuffer, `the body of ${ objectId }`);
            assertEqual(sizes.get(objectId), getByteLength(body), `the manifest's size for ${ objectId }`);
        }
    });

    it('writes nothing on a dry run', async () => {
        const client = makeClient();

        const result = await publish(client, { dryRun: true });

        assertEqual(true, result.dryRun);
        assertEqual(false, result.created);
        assertEqual(compilation.objects.length, result.uploadedCount);
        assertEqual(1, client.statusChecks.length);
        assertEqual(0, client.uploads.length);
        assertEqual(0, client.releases.length);
    });
});

// A server built from this repository's core that stores nothing yet. It
// records what the pipeline sends.
function makeClient() {
    return {
        statusChecks: [],
        uploads: [],
        releases: [],
        async discover() {
            return {
                runningBuildId: 'production',
                contentContractVersion: CONTENT_CONTRACT_VERSION,
                addressingFormat: FORMAT,
                buildAssignmentProtocolVersion: CORE_BUILD_ASSIGNMENT_PROTOCOL_VERSION,
                limits: {
                    maxObjectBytes: MAX_OBJECT_BYTES,
                    maxObjectStatusIds: MAX_OBJECT_STATUS_IDS,
                    maxManifestEntries: MAX_MANIFEST_ENTRIES,
                },
            };
        },
        async getObjectStatus(objectIds) {
            this.statusChecks.push(objectIds);
            return [];
        },
        async uploadObject(objectId, body) {
            this.uploads.push({ objectId, body });
            return { objectId, size: getByteLength(body), created: true };
        },
        async createRelease(manifest, provenance) {
            this.releases.push({ manifest, provenance });
            return { releaseId: 'release-1', objectCount: 0, totalBytes: 0, contractVersion: CONTENT_CONTRACT_VERSION };
        },
    };
}

function getByteLength(body) {
    return isString(body) ? new TextEncoder().encode(body).byteLength : body.byteLength;
}
