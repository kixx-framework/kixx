/**
 * Creates an immutable Publishing API Release from compiled content.
 *
 * This module holds none of the content contract. The objects, their hashes
 * and sizes, and the Release manifest come from the project's own content
 * compiler, and the bytes of an upload from its `serializeContentObject()`.
 * @module publish-content
 */

import {
    assert,
    assertArray,
    assertFunction,
    isPlainObject,
} from '../vendor/kixx-assert/mod.js';

import UsageError from '../usage-error.js';
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
 * @param {Object} args.compilation - What the project's `compileProjectContent()` resolved
 * @param {Array<Object>} args.compilation.objects - Content objects: `{ type, pathname, payload, hash, size, sourceFiles }`
 * @param {?{manifest: Object}} args.compilation.release - Null when the content has problems
 * @param {{problems: Array<Object>, unmatchedFiles: string[]}} args.compilation.report - The compiler's report
 * @param {function(Object): (string|ArrayBuffer)} args.serializeContentObject - The project's serializer for an object's upload body
 * @param {Object} args.expected - The contract versions the project's Kixx composes; see `negotiateCapabilities()`
 * @param {Object} [args.provenance] - Non-binding Release metadata
 * @param {boolean} [args.dryRun=false] - Report the server-backed diff without writes
 * @returns {Promise<Object>} Structured object diff and Release result
 * @throws {UsageError} When the compilation has problems, before any request
 * @throws {PublishContentError} When a Publishing API phase fails
 */
export default async function publishContent(args) {
    const {
        client,
        compilation,
        serializeContentObject,
        expected,
        provenance,
        dryRun = false,
    } = args ?? {};

    assert(client, 'publishContent() requires a Publishing API client');
    assert(compilation, 'publishContent() requires a compilation');
    assertArray(compilation.objects, 'publishContent() compilation.objects');
    assert(isPlainObject(compilation.report), 'publishContent() requires compilation.report');
    assertFunction(serializeContentObject, 'publishContent() requires serializeContentObject');
    assert(isPlainObject(expected), 'publishContent() requires the expected contract versions');
    assertPublishable(compilation);

    const { objects } = compilation;
    const { manifest } = compilation.release;

    const result = makeInitialResult(compilation.report, dryRun);
    let capabilities;

    try {
        // Negotiation owns the version checks; only the per-Release manifest
        // limit is this pipeline's own concern.
        capabilities = await negotiateCapabilities(client, expected);
        assertManifestSize(capabilities, objects.length);
    } catch (cause) {
        throw makePublishError('discovery', cause, result);
    }

    const storedObjects = await runPhase('status', result, () => {
        return client.getObjectStatus(
            objects.map(({ hash }) => hash),
            { maxObjectStatusIds: capabilities.limits.maxObjectStatusIds },
        );
    });
    const storedIds = new Set(storedObjects.map(({ objectId }) => objectId));
    const pendingResources = objects.filter(({ hash }) => !storedIds.has(hash));
    const matchedResources = objects.filter(({ hash }) => storedIds.has(hash));

    result.matchedCount = matchedResources.length;
    result.uploadedCount = pendingResources.length;
    result.uploadedResources = pendingResources.map(summarizeResource);
    result.resources = objects.map((resource) => ({
        ...summarizeResource(resource),
        disposition: storedIds.has(resource.hash) ? 'matched' : 'uploaded',
    }));

    if (dryRun) {
        return result;
    }

    const pendingObjects = deduplicateObjects(pendingResources, serializeContentObject);
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

// A compilation with problems has no Release. Every problem is listed, so
// one run shows everything there is to fix.
function assertPublishable(compilation) {
    if (compilation.release) {
        return;
    }

    const problems = compilation.report.problems ?? [];

    throw new UsageError([
        'The content has problems:',
        ...problems.map(({ filepath, message }) => {
            return filepath ? `- ${ filepath }: ${ message }` : `- ${ message }`;
        }),
        'Nothing was published.',
    ].join('\n'));
}

function makeInitialResult(report, dryRun) {
    return {
        dryRun,
        created: false,
        matchedCount: 0,
        uploadedCount: 0,
        completedUploadCount: 0,
        uploadedResources: [],
        resources: [],
        unmatchedFiles: [ ...(report.unmatchedFiles ?? []) ],
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

function deduplicateObjects(resources, serializeContentObject) {
    const objects = new Map();

    for (const resource of resources) {
        const existing = objects.get(resource.hash);
        if (existing) {
            existing.resources.push(resource);
            continue;
        }

        objects.set(resource.hash, {
            objectId: resource.hash,
            payload: serializeContentObject(resource),
            size: resource.size,
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
