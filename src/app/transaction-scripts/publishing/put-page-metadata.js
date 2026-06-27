import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { AssertionError, ConflictError } from '../../../kixx/errors/mod.js';


/**
 * Writes a page metadata file (`page.json`) into a build namespace.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Page metadata write arguments.
 * @param {string} args.pathname - Normalized page pathname.
 * @param {Object} args.metadata - Complete page metadata bag.
 * @param {string|null} [args.buildId] - Optional target build id.
 * @returns {Promise<{ filepath: string, buildId: string }>} Written filepath and effective build id.
 * @throws {ConflictError} When no buildId is provided and the deployment has no current build id.
 * @throws {AssertionError} When the service write fails.
 */
export async function putPageMetadata(context, args) {
    const {
        pathname,
        metadata,
        buildId,
    } = args ?? {};

    const currentBuildId = context.runtime.build?.id ?? null;
    const effectiveBuildId = isNonEmptyString(buildId) ? buildId : currentBuildId;

    // A live-build write (no buildId provided) needs a configured current build
    // to target. Surface the missing-build deployment state as a client-visible
    // 409, consistent with putTemplate, rather than an opaque 500.
    if (!isNonEmptyString(effectiveBuildId)) {
        throw new ConflictError('A current build id is required before pages can be published.', {
            code: 'CurrentBuildIdRequired',
        });
    }

    const service = context.getService('Hyperview');

    try {
        const written = await service.putPageMetadata(context, effectiveBuildId, pathname, metadata);
        return {
            filepath: written.filepath,
            buildId: effectiveBuildId,
        };
    } catch (cause) {
        throw new AssertionError('Unexpected error while writing page metadata', { cause });
    }
}
