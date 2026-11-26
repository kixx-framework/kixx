import { describe } from 'kixx-test';
import {
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
        assertEqual(
            'baseTemplates,globalTemplatePartials,pages,staticAssets',
            Object.keys(manifest).sort().join(','),
        );
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
                objectCount: countManifestEntries(manifest),
                totalBytes: 100,
                contractVersion: 2,
            };
        },
    };
}

function countManifestEntries(manifest) {
    let count = Object.keys(manifest.staticAssets).length;
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
