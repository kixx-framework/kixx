import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    isString,
} from '../../../lib/vendor/kixx-assert/mod.js';

import publishContent from '../../../lib/publishing/publish-content.js';


describe('publishing/publish-content', ({ it }) => {
    it('creates a complete Release without uploading stored objects', async () => {
        const resources = makeAllResourceTypes();
        const client = makeClient({ storedIds: resources.map(({ hash }) => hash) });

        const result = await publishContent(makeArgs(client, resources));

        assertEqual(resources.length, result.matchedCount);
        assertEqual(0, result.uploadedCount);
        assertEqual(0, client.uploads.length);
        assertEqual('release-1', result.releaseId);
        assertEqual(resources.length, result.objectCount);

        const manifest = client.releases[0].manifest;
        assertEqual('static-hash', manifest.staticAssets['/site.css'].objectId);
        assertEqual('text/css', manifest.staticAssets['/site.css'].mediaType);
        assertEqual('global-hash', manifest.globalTemplatePartials.objectId);
        assertEqual('base-hash', manifest.baseTemplates.objectId);
        assertEqual('metadata-hash', manifest.pages['/about'].metadata.objectId);
        assertEqual('partials-hash', manifest.pages['/about'].partials.objectId);
        assertEqual('includes-hash', manifest.pages['/about'].includes.objectId);
        assertEqual('template-hash', manifest.pages['/about'].templates['page.html'].objectId);
        assertEqual('email-hash', manifest.emails['/welcome'].objectId);
        assertEqual('revision', client.releases[0].provenance.sourceRevision);
    });

    it('uploads only missing objects using their canonical bytes', async () => {
        const matched = makeResource('StaticAsset', 'same.css', 'same-hash', 'same');
        const structured = makeResource(
            'PageMetadata',
            '/',
            'metadata-hash',
            { z: 2, a: 1 },
        );
        const client = makeClient({ storedIds: [ matched.hash ] });

        const result = await publishContent(makeArgs(client, [ matched, structured ]));

        assertEqual(1, result.matchedCount);
        assertEqual(1, result.uploadedCount);
        assertEqual(1, result.completedUploadCount);
        assertEqual('metadata-hash', client.uploads[0].objectId);
        assertEqual('{"a":1,"z":2}', client.uploads[0].payload);
        assertEqual('metadata-hash', client.releases[0].manifest.pages['/'].metadata.objectId);
    });

    it('builds every Release only from the current local scan', async () => {
        const first = makeResource('StaticAsset', 'first.css', 'first-hash');
        const second = makeResource('StaticAsset', 'second.css', 'second-hash');
        const client = makeClient({ storedIds: [ first.hash, second.hash ] });

        await publishContent(makeArgs(client, [ first, second ]));
        await publishContent(makeArgs(client, [ second ]));

        const latest = client.releases[1].manifest;
        assertEqual(1, Object.keys(latest.staticAssets).length);
        assertEqual('second-hash', latest.staticAssets['/second.css'].objectId);
        assertEqual(undefined, latest.staticAssets['/first.css']);
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

    it('rejects unsupported servers before status or writes', async () => {
        for (const capabilities of [
            makeCapabilities({ contentContractVersion: 2 }),
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
});

function makeArgs(client, resources) {
    return {
        client,
        contentSources: {
            resources,
            unmatchedFiles: [ 'templates/README.md' ],
            problems: [],
        },
        provenance: { sourceRevision: 'revision' },
    };
}

function makeAllResourceTypes() {
    return [
        makeResource('StaticAsset', 'site.css', 'static-hash', 'body {}', 'text/css'),
        makeResource('GlobalTemplatePartials', '/', 'global-hash', []),
        makeResource('BaseTemplates', '/', 'base-hash', []),
        makeResource('PageMetadata', '/about', 'metadata-hash', {}),
        makeResource('PagePartials', '/about', 'partials-hash', []),
        makeResource('PageIncludes', '/about', 'includes-hash', {}),
        makeResource('PageTemplate', '/about/page.html', 'template-hash', '<main></main>'),
        makeResource('EmailAssets', '/welcome', 'email-hash', {}),
    ];
}

function makeResource(type, pathname, hash, payload = 'payload', mediaType) {
    return {
        type,
        pathname,
        payload,
        hash,
        size: isString(payload) ? payload.length : 1,
        mediaType,
        sourceFiles: [],
    };
}

function makeCapabilities(overrides) {
    return {
        runningBuildId: 'production',
        contentContractVersion: 1,
        addressingFormat: 4,
        buildAssignmentProtocolVersion: 2,
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
            this.activeUploads += 1;
            this.maxActiveUploads = Math.max(this.maxActiveUploads, this.activeUploads);
            await delay(uploadDelay);
            this.activeUploads -= 1;

            if (objectId === failUploadId) {
                throw new Error(`Upload failed for ${ objectId }`);
            }

            return { objectId, size: 1, created: true };
        },
        async createRelease(manifest, provenance) {
            this.releases.push({ manifest, provenance });
            return {
                releaseId: `release-${ this.releases.length }`,
                objectCount: countManifestEntries(manifest),
                totalBytes: 100,
                contractVersion: 1,
            };
        },
    };
}

function countManifestEntries(manifest) {
    let count = Object.keys(manifest.staticAssets).length + Object.keys(manifest.emails).length;
    count += manifest.globalTemplatePartials ? 1 : 0;
    count += manifest.baseTemplates ? 1 : 0;

    for (const page of Object.values(manifest.pages)) {
        count += page.metadata ? 1 : 0;
        count += page.partials ? 1 : 0;
        count += page.includes ? 1 : 0;
        count += Object.keys(page.templates ?? {}).length;
    }

    return count;
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
