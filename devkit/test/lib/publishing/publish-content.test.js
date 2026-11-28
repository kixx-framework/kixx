import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    isString,
} from '../../../lib/vendor/kixx-assert/mod.js';

import publishContent from '../../../lib/publishing/publish-content.js';


// What the project's Kixx composes; the caller passes it in.
const EXPECTED = Object.freeze({ contentContractVersion: 2, addressingFormat: 4 });


describe('publishing/publish-content', ({ it }) => {
    it('creates a complete Release without uploading stored objects', async () => {
        const objects = makeAllObjectTypes();
        const client = makeClient({ storedIds: objects.map(({ hash }) => hash) });
        const args = makeArgs(client, objects);

        const result = await publishContent(args);

        assertEqual(objects.length, result.matchedCount);
        assertEqual(0, result.uploadedCount);
        assertEqual(0, client.uploads.length);
        assertEqual('release-1', result.releaseId);
        assertEqual(objects.length, result.objectCount);
        assertEqual('templates/README.md', result.unmatchedFiles.join(','));

        // The manifest is the compiler's, sent as it is.
        assert(client.releases[0].manifest === args.compilation.release.manifest, 'sends release.manifest');
        assertEqual(1, client.releases.length);
        assertEqual('revision', client.releases[0].provenance.sourceRevision);
    });

    it('rejects unsupported servers before status or writes', async () => {
        for (const capabilities of [
            makeCapabilities({ contentContractVersion: 1 }),
            makeCapabilities({ addressingFormat: 3 }),
            makeCapabilities({ buildAssignmentProtocolVersion: undefined }),
        ]) {
            const client = makeClient({ capabilities });
            const caught = await catchAsyncError(() => {
                return publishContent(makeArgs(client, [
                    makeResource('StaticAsset', 'site.css', 'hash'),
                ]));
            });

            assertEqual('discovery', caught.phase);
            assertMatches('incompatible with this version of the devkit', caught.message);
            assertEqual(0, client.statusChecks.length);
            assertEqual(0, client.uploads.length);
            assertEqual(0, client.releases.length);
        }
    });

    it('compares the server with the versions it is given', async () => {
        const client = makeClient({ capabilities: makeCapabilities({ contentContractVersion: 3, addressingFormat: 5 }) });

        const result = await publishContent({
            ...makeArgs(client, [ makeResource('StaticAsset', 'site.css', 'hash') ]),
            expected: { contentContractVersion: 3, addressingFormat: 5 },
        });

        assertEqual(true, result.created);
    });

    it('refuses a compilation with problems before any request', async () => {
        const client = makeClient();
        const args = makeArgs(client, [ makeResource('StaticAsset', 'site.css', 'hash') ]);

        args.compilation.release = null;
        args.compilation.report.problems = [
            { code: 'template-syntax', filepath: 'pages/about/page.html', message: 'Unclosed block' },
            { code: 'invalid-release', filepath: '', message: 'Too many entries' },
        ];

        const caught = await catchAsyncError(() => publishContent(args));

        assertEqual('UsageError', caught.name);
        assertEqual([
            'The content has problems:',
            '- pages/about/page.html: Unclosed block',
            '- Too many entries',
            'Nothing was published.',
        ].join('\n'), caught.message);
        assertEqual(0, client.discoveryCount);
        assertEqual(0, client.statusChecks.length);
        assertEqual(0, client.uploads.length);
        assertEqual(0, client.releases.length);
    });

    it('requires the compilation, the serializer, and the expected versions', async () => {
        const client = makeClient();
        const args = makeArgs(client, [ makeResource('StaticAsset', 'site.css', 'hash') ]);

        for (const name of [ 'compilation', 'serializeContentObject', 'expected' ]) {
            const caught = await catchAsyncError(() => publishContent({ ...args, [name]: undefined }));

            assertEqual('AssertionError', caught?.name, name);
        }

        assertEqual(0, client.discoveryCount);
    });

    it('uploads only missing objects, with the bytes the serializer returns', async () => {
        const matched = makeResource('StaticAsset', 'same.css', 'same-hash', 'same');
        const structured = makeResource('PageMetadata', '/', 'metadata-hash', { z: 2, a: 1 });
        const client = makeClient({ storedIds: [ matched.hash ] });
        const serialized = [];

        const result = await publishContent({
            ...makeArgs(client, [ matched, structured ]),
            serializeContentObject(object) {
                serialized.push(object);
                return `bytes of ${ object.hash }`;
            },
        });

        assertEqual(1, result.matchedCount);
        assertEqual(1, result.uploadedCount);
        assertEqual(1, result.completedUploadCount);
        assertEqual(1, serialized.length);
        assert(serialized[0] === structured, 'serializes the object itself');
        assertEqual('metadata-hash', client.uploads[0].objectId);
        assertEqual('bytes of metadata-hash', client.uploads[0].payload);
    });

    it('uploads an object two resources share once', async () => {
        const client = makeClient();

        const result = await publishContent(makeArgs(client, [
            makeResource('StaticAsset', 'a.css', 'shared-hash'),
            makeResource('StaticAsset', 'b.css', 'shared-hash'),
            makeResource('StaticAsset', 'c.css', 'other-hash'),
        ]));

        assertEqual('shared-hash,other-hash', client.uploads.map(({ objectId }) => objectId).join(','));
        assertEqual(3, result.uploadedCount);
        assertEqual(2, result.completedUploadCount);
    });

    it('performs discovery and object status only during a dry run', async () => {
        const stored = makeResource('StaticAsset', 'same.css', 'same-hash');
        const missing = makeResource('StaticAsset', 'new.css', 'new-hash');
        const client = makeClient({ storedIds: [ stored.hash ] });

        const result = await publishContent({
            ...makeArgs(client, [ stored, missing ]),
            dryRun: true,
        });

        assert(result.dryRun);
        assertEqual(1, result.matchedCount);
        assertEqual(1, result.uploadedCount);
        assertEqual(1, client.discoveryCount);
        assertEqual(1, client.statusChecks.length);
        assertEqual(0, client.uploads.length);
        assertEqual(0, client.releases.length);
    });

    it('rejects every oversized object before starting uploads', async () => {
        const capabilities = makeCapabilities();
        capabilities.limits.maxObjectBytes = 3;
        const resources = [
            makeResource('StaticAsset', 'small.css', 'small-hash', 'ok'),
            makeResource('StaticAsset', 'large-a.css', 'large-hash', 'éé'),
            makeResource('StaticAsset', 'large-b.css', 'large-hash', 'éé'),
        ];
        resources[1].sourceFiles = [ 'static-assets/large-a.css' ];
        resources[2].sourceFiles = [ 'public/large-b.css' ];
        const client = makeClient({ capabilities });

        const caught = await catchAsyncError(() => {
            return publishContent(makeArgs(client, resources));
        });

        assertEqual('UsageError', caught.name);
        assertMatches('server limit of 3 bytes', caught.message);
        assertMatches('large-a.css": 4 bytes; sources: static-assets/large-a.css', caught.message);
        assertMatches('large-b.css": 4 bytes; sources: public/large-b.css', caught.message);
        assertMatches('Nothing was published.', caught.message);
        assertEqual(1, client.statusChecks.length);
        assertEqual(0, client.uploads.length);
        assertEqual(0, client.releases.length);
    });

    it('waits for in-flight uploads and prevents Release creation after failure', async () => {
        const resources = [
            makeResource('StaticAsset', 'one.css', 'one-hash'),
            makeResource('StaticAsset', 'two.css', 'two-hash'),
        ];
        const client = makeClient({ failUploadId: 'one-hash', uploadDelay: 2 });

        const caught = await catchAsyncError(() => publishContent(makeArgs(client, resources)));

        assertEqual('PublishContentError', caught.name);
        assertEqual('upload', caught.phase);
        assertMatches('No Release was created', caught.message);
        assertMatches('unreferenced, inert', caught.message);
        assertEqual(0, client.releases.length);
        assertEqual(0, client.activeUploads);
    });

    it('limits object upload concurrency to six requests', async () => {
        const resources = Array.from({ length: 17 }, (_value, index) => {
            return makeResource('StaticAsset', `asset-${ index }.css`, `hash-${ index }`);
        });
        const client = makeClient({ uploadDelay: 2 });

        await publishContent(makeArgs(client, resources));

        assertEqual(6, client.maxActiveUploads);
    });

    it('drops to one upload at a time after the server reports an overload', async () => {
        const resources = Array.from({ length: 20 }, (_value, index) => {
            return makeResource('StaticAsset', `asset-${ index }.css`, `hash-${ index }`);
        });
        const client = makeClient({ uploadDelay: 2, overloadAfterFirstUpload: true });

        const result = await publishContent(makeArgs(client, resources));

        const uploadedIds = client.uploads.map(({ objectId }) => objectId);
        assertEqual(20, uploadedIds.length);
        assertEqual(20, new Set(uploadedIds).size);
        assertEqual(6, client.maxActiveUploads);

        // Once the uploads in flight at the overload have drained, only one
        // upload is ever active.
        const drainedStarts = client.overloadedStarts.filter(({ preOverloadActive }) => preOverloadActive === 0);
        assert(drainedStarts.length >= 13, `expected at least 13 serial uploads, got ${ drainedStarts.length }`);
        for (const { active } of drainedStarts) {
            assertEqual(1, active);
        }

        assertEqual(1, client.releases.length);
        assertEqual(true, result.created);
    });

    it('uploads one at a time when the server is already overloaded', async () => {
        const resources = Array.from({ length: 10 }, (_value, index) => {
            return makeResource('StaticAsset', `asset-${ index }.css`, `hash-${ index }`);
        });
        const client = makeClient({ uploadDelay: 1, serverOverloaded: true });

        await publishContent(makeArgs(client, resources));

        assertEqual(10, client.uploads.length);
        assertEqual(1, client.maxActiveUploads);
    });

    it('reports an upload failure after the drop as an upload phase error', async () => {
        const resources = Array.from({ length: 5 }, (_value, index) => {
            return makeResource('StaticAsset', `asset-${ index }.css`, `hash-${ index }`);
        });
        const client = makeClient({ serverOverloaded: true, failUploadId: 'hash-2' });

        const caught = await catchAsyncError(() => publishContent(makeArgs(client, resources)));

        assertEqual('PublishContentError', caught.name);
        assertEqual('upload', caught.phase);
        assertEqual(3, client.uploads.length);
        assertEqual(0, client.releases.length);
    });
});

function makeArgs(client, objects) {
    return {
        client,
        compilation: makeCompilation(objects),
        serializeContentObject: (object) => `bytes of ${ object.hash }`,
        expected: EXPECTED,
        provenance: { sourceRevision: 'revision' },
    };
}

// Shaped like what compileProjectContent() resolves. The manifest is opaque
// to the pipeline, so this one is not a real Release manifest.
function makeCompilation(objects) {
    return {
        objects,
        release: { manifest: { entries: objects.map(({ hash }) => hash) } },
        report: {
            problems: [],
            unmatchedFiles: [ 'templates/README.md' ],
        },
    };
}

function makeAllObjectTypes() {
    return [
        makeResource('StaticAsset', 'site.css', 'static-hash', 'body {}'),
        makeResource('GlobalTemplatePartials', '/', 'global-hash', []),
        makeResource('BaseTemplates', '/', 'base-hash', []),
        makeResource('PageMetadata', '/about', 'metadata-hash', {}),
        makeResource('PagePartials', '/about', 'partials-hash', []),
        makeResource('PageIncludes', '/about', 'includes-hash', {}),
        makeResource('PageTemplate', '/about/page.html', 'template-hash', '<main></main>'),
    ];
}

// A content object. The compiler supplies the size, in bytes.
function makeResource(type, pathname, hash, payload = 'payload') {
    return {
        type,
        pathname,
        payload,
        hash,
        size: isString(payload) ? new TextEncoder().encode(payload).byteLength : 1,
        sourceFiles: [],
    };
}

function makeCapabilities(overrides) {
    return {
        runningBuildId: 'production',
        contentContractVersion: 2,
        addressingFormat: 4,
        buildAssignmentProtocolVersion: 4,
        limits: {
            maxObjectBytes: 26_214_400,
            maxObjectStatusIds: 100,
            maxManifestEntries: 10_000,
        },
        ...overrides,
    };
}

function makeClient(options) {
    const {
        capabilities = makeCapabilities(),
        storedIds = [],
        failUploadId = null,
        uploadDelay = 0,
        serverOverloaded,
        overloadAfterFirstUpload = false,
    } = options ?? {};

    return {
        capabilities,
        storedIds: new Set(storedIds),
        discoveryCount: 0,
        statusChecks: [],
        uploads: [],
        releases: [],
        activeUploads: 0,
        maxActiveUploads: 0,
        // Undefined by default, like a client without the getter.
        serverOverloaded,
        overloadedStarts: [],
        preOverloadActive: 0,
        async discover() {
            this.discoveryCount += 1;
            return this.capabilities;
        },
        async getObjectStatus(objectIds, limits) {
            this.statusChecks.push({ objectIds, limits });
            return objectIds
                .filter((objectId) => this.storedIds.has(objectId))
                .map((objectId) => ({ objectId, size: 1 }));
        },
        async uploadObject(objectId, payload, limits) {
            this.uploads.push({ objectId, payload, limits });
            const startedOverloaded = this.serverOverloaded === true;
            this.activeUploads += 1;
            this.maxActiveUploads = Math.max(this.maxActiveUploads, this.activeUploads);

            if (startedOverloaded) {
                this.overloadedStarts.push({
                    active: this.activeUploads,
                    preOverloadActive: this.preOverloadActive,
                });
            } else {
                this.preOverloadActive += 1;
            }

            await delay(uploadDelay);

            // Flip while the other first-wave uploads are still in flight.
            if (overloadAfterFirstUpload) {
                this.serverOverloaded = true;
            }

            this.activeUploads -= 1;
            if (!startedOverloaded) {
                this.preOverloadActive -= 1;
            }

            if (objectId === failUploadId) {
                throw new Error(`Upload failed for ${ objectId }`);
            }

            return { objectId, size: 1, created: true };
        },
        async createRelease(manifest, provenance) {
            this.releases.push({ manifest, provenance });
            return {
                releaseId: `release-${ this.releases.length }`,
                objectCount: manifest.entries.length,
                totalBytes: 100,
                contractVersion: 2,
            };
        },
    };
}

async function delay(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
