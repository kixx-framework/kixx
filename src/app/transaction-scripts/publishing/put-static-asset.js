import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import {
    AssertionError,
    BadRequestError,
    ConflictError,
} from '../../../kixx/errors/mod.js';
import { validateBuildId } from '../../../kixx/utils/build-id.js';
import { computeStaticFileEtag } from '../../../kixx/static-file-server/static-file-etag.js';


/**
 * Writes a static asset's bytes into a non-current build namespace.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Asset write arguments.
 * @param {string} args.filepath - Served asset path, used as the store key.
 * @param {ArrayBuffer|Uint8Array} args.body - Buffered asset bytes.
 * @param {string} args.contentType - Media type to store and serve.
 * @param {string} args.buildId - Target (staged, non-current) build id.
 * @returns {Promise<{ filepath: string, buildId: string, contentType: string, contentLength: number, etag: string }>}
 *   The written asset's parts.
 * @throws {BadRequestError} When the body is empty or the buildId is missing.
 * @throws {ConflictError} When buildId targets the current build or an existing asset differs.
 * @throws {AssertionError} When static-file store access unexpectedly fails.
 */
export async function putStaticAsset(context, args) {
    const {
        filepath,
        body,
        contentType,
        buildId,
    } = args ?? {};

    // An empty body is client input; reject it as a 400 here so it never reaches
    // the store, which has no meaningful asset to write.
    if (!body || body.byteLength === 0) {
        throw new BadRequestError('Static asset source bytes are required.', {
            code: 'StaticAssetSourceRequired',
        });
    }

    if (!isNonEmptyString(buildId)) {
        throw new BadRequestError('Kixx-Build-Id is required for static asset writes.', {
            code: 'BuildIdRequired',
        });
    }

    validateBuildId(buildId);

    // Asset writes are staged-only: they must target a build other than the live
    // one so the current asset set stays immutable until an atomic promotion. A
    // missing current build id (site never deployed) lets the first deploy stage
    // its assets, and is vacuously safe because a non-empty buildId can never
    // equal null.
    const currentBuildId = context.runtime.build?.id ?? null;

    if (buildId === currentBuildId) {
        throw new ConflictError('Static asset writes must target a build other than the current build.', {
            code: 'CurrentBuildWriteConflict',
        });
    }

    const etag = await computeStaticFileEtag(body);
    const store = context.getService('StaticFileStore');

    let existing;
    try {
        existing = await store.read(context, {
            key: filepath,
            namespace: buildId,
            computeEtag: true,
        });
    } catch (cause) {
        throw new AssertionError('Unexpected error while reading an existing static asset', { cause });
    }

    if (existing) {
        try {
            await cancelBody(existing.body);
        } catch (cause) {
            throw new AssertionError('Unexpected error while cancelling an existing static asset body', { cause });
        }

        if (existing.etag === etag
            && existing.contentLength === body.byteLength
            && existing.contentType === contentType) {
            return {
                filepath,
                buildId,
                contentType: existing.contentType,
                contentLength: existing.contentLength,
                etag: existing.etag,
            };
        }

        // This is only a sequential guarantee: concurrent first writers can both
        // observe a miss, so publishing clients must serialize one asset address.
        throw new ConflictError('Static asset address already exists with different content or content type.', {
            code: 'StaticAssetImmutableConflict',
        });
    }

    let written;
    try {
        written = await store.write(context, {
            key: filepath,
            namespace: buildId,
            body,
            contentType,
        });
    } catch (cause) {
        throw new AssertionError('Unexpected error while writing a static asset', { cause });
    }

    return {
        filepath: written.key,
        buildId,
        contentType: written.contentType,
        contentLength: written.contentLength,
        etag: written.etag,
    };
}

async function cancelBody(body) {
    if (body) {
        await body.cancel();
    }
}
