/**
 * Creates an immutable Publishing API Release from scanned local content.
 * @module publish-content
 */

import path from 'node:path';

import {
    assert,
    assertArray,
    isString,
    isUndefined,
} from '../vendor/kixx-assert/mod.js';

import UsageError from '../usage-error.js';
import { canonicalize, getBlobSize } from './addressing.js';
import { normalizePathname } from './content-layout.js';
import { assertPublishableContentSources } from './content-source-report.js';
import negotiateCapabilities from './negotiate-capabilities.js';

const MAX_CONCURRENCY = 6;
// Upload one object at a time once the server reports an overload. The drop
// is sticky for the run: the store has already shown it cannot keep up.
const OVERLOADED_CONCURRENCY = 1;

/**
 * A Release creation failure enriched with the last known pipeline state.
 */
export class PublishContentError extends Error {

    /**
     * @param {string} message - Operator-facing failure description
     * @param {Object} options - Failure details
     * @param {string} options.phase - Pipeline phase that failed
     * @param {Object} options.result - Partial publish result
     * @param {Error} options.cause - Underlying failure
     */
    constructor(message, options) {
        const { phase, result, cause } = options ?? {};

        super(message, { cause });

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: this.constructor.name,
            },
            code: {
                enumerable: true,
                value: this.constructor.name,
            },
            phase: {
                enumerable: true,
                value: phase,
            },
            result: {
                enumerable: true,
                value: result,
            },
        });
    }
}

/**
 * Uploads missing content objects and creates one complete immutable Release.
 * @param {Object} args - Publish inputs and options
 * @param {Object} args.client - Publishing API client
 * @param {Object} args.contentSources - Result from `scanContentSources()`
 * @param {Object} [args.provenance] - Non-binding Release metadata
 * @param {boolean} [args.dryRun=false] - Report the server-backed diff without writes
 * @returns {Promise<Object>} Structured object diff and Release result
 * @throws {UsageError} When content validation prevents publishing
 * @throws {PublishContentError} When a Publishing API phase fails
 */
export default async function publishContent(args) {
    const {
        client,
        contentSources,
        provenance,
        dryRun = false,
    } = args ?? {};

    assert(client, 'publishContent() requires a Publishing API client');
    assert(contentSources, 'publishContent() requires scanned content sources');
    assertArray(contentSources.resources, 'publishContent() contentSources.resources');
    assertPublishableContentSources(contentSources);

    const result = makeInitialResult(contentSources, dryRun);
    let capabilities;

    try {
        // Negotiation owns the version checks; only the per-Release manifest
        // limit is this pipeline's own concern.
        capabilities = await negotiateCapabilities(client);
        assertManifestSize(capabilities, contentSources.resources.length);
    } catch (cause) {
        throw makePublishError('discovery', cause, result);
    }

    const storedObjects = await runPhase('status', result, () => {
        return client.getObjectStatus(
            contentSources.resources.map(({ hash }) => hash),
            { maxObjectStatusIds: capabilities.limits.maxObjectStatusIds },
        );
    });
    const storedIds = new Set(storedObjects.map(({ objectId }) => objectId));
    const pendingResources = contentSources.resources.filter(({ hash }) => !storedIds.has(hash));
    const matchedResources = contentSources.resources.filter(({ hash }) => storedIds.has(hash));

    result.matchedCount = matchedResources.length;
    result.uploadedCount = pendingResources.length;
    result.uploadedResources = pendingResources.map(summarizeResource);
    result.resources = contentSources.resources.map((resource) => ({
        ...summarizeResource(resource),
        disposition: storedIds.has(resource.hash) ? 'matched' : 'uploaded',
    }));

    if (dryRun) {
        return result;
    }

    const pendingObjects = deduplicateObjects(pendingResources);
    assertPendingObjectSizes(
        pendingObjects,
        capabilities.limits.maxObjectBytes,
    );
    await runPhase('upload', result, () => {
        // A client without the getter (a fake or older client) reads as not
        // overloaded and keeps full concurrency.
        const getConcurrency = () => {
            return client.serverOverloaded === true ? OVERLOADED_CONCURRENCY : MAX_CONCURRENCY;
        };

        return mapWithConcurrency(pendingObjects, getConcurrency, async ({ objectId, payload }) => {
            const uploaded = await client.uploadObject(objectId, payload, {
                maxObjectBytes: capabilities.limits.maxObjectBytes,
            });
            result.completedUploadCount += 1;
            return uploaded;
        });
    });

    const manifest = makeReleaseManifest(contentSources.resources);
    const release = await runPhase('release', result, () => {
        return client.createRelease(manifest, provenance);
    });

    result.created = true;
    result.releaseId = release.releaseId;
    result.objectCount = release.objectCount;
    result.totalBytes = release.totalBytes;
    result.contractVersion = release.contractVersion;

    return result;
}

function makeInitialResult(contentSources, dryRun) {
    return {
        dryRun,
        created: false,
        matchedCount: 0,
        uploadedCount: 0,
        completedUploadCount: 0,
        uploadedResources: [],
        resources: [],
        unmatchedFiles: [ ...contentSources.unmatchedFiles ],
        releaseId: null,
        objectCount: null,
        totalBytes: null,
        contractVersion: null,
    };
}

function assertManifestSize(capabilities, manifestEntryCount) {
    assert(
        manifestEntryCount <= capabilities.limits.maxManifestEntries,
        `Release has ${ manifestEntryCount } entries; server limit is ` +
            `${ capabilities.limits.maxManifestEntries }`,
    );
}

function deduplicateObjects(resources) {
    const objects = new Map();

    for (const resource of resources) {
        const existing = objects.get(resource.hash);
        if (existing) {
            existing.resources.push(resource);
            continue;
        }

        const payload = getObjectPayload(resource.payload);
        objects.set(resource.hash, {
            objectId: resource.hash,
            payload,
            size: getBlobSize(payload),
            resources: [ resource ],
        });
    }

    return [ ...objects.values() ];
}

function assertPendingObjectSizes(objects, maxObjectBytes) {
    const oversizedResources = objects.flatMap((object) => {
        if (object.size <= maxObjectBytes) {
            return [];
        }

        return object.resources.map((resource) => ({
            resource,
            size: object.size,
        }));
    });

    if (oversizedResources.length === 0) {
        return;
    }

    const details = oversizedResources.map(({ resource, size }) => {
        const sources = resource.sourceFiles.length > 0
            ? `; sources: ${ resource.sourceFiles.join(', ') }`
            : '';
        return `- ${ resource.type } "${ resource.pathname }": ${ size } bytes${ sources }`;
    });

    throw new UsageError([
        `Content objects exceed the server limit of ${ maxObjectBytes } bytes:`,
        ...details,
        'Nothing was published.',
    ].join('\n'));
}

function getObjectPayload(payload) {
    if (isString(payload) || payload instanceof ArrayBuffer) {
        return payload;
    }
    return canonicalize(payload);
}

/**
 * Builds the Release manifest `POST /releases` receives from scanned resources.
 * @param {Array<Object>} resources - `resources` from `scanContentSources()`
 * @returns {Object} Release manifest
 */
export function makeReleaseManifest(resources) {
    const manifest = {
        staticAssets: {},
        pages: {},
        emails: {},
    };

    for (const resource of resources) {
        const reference = makeReference(resource);

        switch (resource.type) {
            case 'StaticAsset':
                manifest.staticAssets[normalizePathname(resource.pathname)] = reference;
                break;
            case 'GlobalTemplatePartials':
                manifest.globalTemplatePartials = reference;
                break;
            case 'BaseTemplates':
                manifest.baseTemplates = reference;
                break;
            case 'PageMetadata':
                getPage(manifest, resource.pathname).metadata = reference;
                break;
            case 'PagePartials':
                getPage(manifest, resource.pathname).partials = reference;
                break;
            case 'PageIncludes':
                getPage(manifest, resource.pathname).includes = reference;
                break;
            case 'PageTemplate': {
                const pagePathname = normalizePathname(path.posix.dirname(resource.pathname));
                const filename = path.posix.basename(resource.pathname);
                const page = getPage(manifest, pagePathname);
                page.templates ??= {};
                page.templates[filename] = reference;
                break;
            }
            case 'EmailAssets':
                manifest.emails[normalizePathname(resource.pathname)] = reference;
                break;
            default:
                assert(false, `Unsupported publishing resource type: ${ resource.type }`);
        }
    }

    return manifest;
}

function makeReference(resource) {
    const reference = {
        objectId: resource.hash,
        size: resource.size,
    };

    if (resource.type === 'StaticAsset' && !isUndefined(resource.mediaType)) {
        reference.mediaType = resource.mediaType;
    }

    return reference;
}

function getPage(manifest, pathname) {
    const normalized = normalizePathname(pathname);
    manifest.pages[normalized] ??= {};
    return manifest.pages[normalized];
}

function summarizeResource(resource) {
    return {
        type: resource.type,
        pathname: resource.pathname,
        hash: resource.hash,
        size: resource.size,
    };
}

async function runPhase(phase, result, fn) {
    try {
        return await fn();
    } catch (cause) {
        throw makePublishError(phase, cause, result);
    }
}

// Runs mapper over items with up to getConcurrency() workers. The limit is
// read before each item: a worker whose index is at or above it exits, so
// the pool can shrink mid-run but never grows. Worker 0 always continues,
// so every item is processed.
async function mapWithConcurrency(items, getConcurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let firstError = null;

    const worker = async (workerIndex) => {
        while (!firstError && nextIndex < items.length) {
            if (workerIndex > 0 && workerIndex >= getConcurrency()) {
                return;
            }

            const index = nextIndex;
            nextIndex += 1;

            try {
                results[index] = await mapper(items[index], index);
            } catch (error) {
                firstError ??= error;
            }
        }
    };

    const workers = Array.from(
        { length: Math.min(getConcurrency(), items.length) },
        (_, workerIndex) => worker(workerIndex),
    );
    await Promise.all(workers);

    if (firstError) {
        throw firstError;
    }

    return results;
}

function makePublishError(phase, cause, result) {
    const prefix = `Release creation failed during the ${ phase } phase: ${ cause.message }`;
    let consequence;

    if (phase === 'discovery' || phase === 'status') {
        consequence = 'No object or Release write was attempted.';
    } else if (phase === 'release') {
        consequence = 'No Release was created. Uploaded objects remain unreferenced, inert, and safe to retry.';
    } else {
        consequence = 'No Release was created. Any uploaded objects remain unreferenced, inert, and safe to retry.';
    }

    return new PublishContentError(`${ prefix }\n${ consequence }`, {
        phase,
        result: { ...result },
        cause,
    });
}
