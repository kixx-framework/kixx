import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import { AssertionError, BadRequestError, ConflictError } from '../../../kixx/errors/mod.js';


/**
 * Writes an include content file into a build namespace.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Include write arguments.
 * @param {string} args.pathname - Normalized page pathname the include belongs to.
 * @param {string} args.filename - Page-relative include filename.
 * @param {string} args.source - Include source text.
 * @param {string|null} [args.buildId] - Optional target build id.
 * @returns {Promise<{ filepath: string, buildId: string }>} Written filepath and effective build id.
 * @throws {BadRequestError} When the source text is missing.
 * @throws {ConflictError} When no buildId is provided and the deployment has no current build id.
 * @throws {AssertionError} When the service write fails.
 */
export async function putInclude(context, args) {
    const {
        pathname,
        filename,
        source,
        buildId,
    } = args ?? {};

    // An empty body is client input; reject it as a 400 here so it never reaches
    // the page data store, which treats a blank source as a broken invariant
    // (AssertionError -> 500).
    if (!isNonEmptyString(source)) {
        throw new BadRequestError('Include source text is required.', {
            code: 'IncludeSourceRequired',
        });
    }

    const currentBuildId = context.runtime.build?.id ?? null;
    const effectiveBuildId = isNonEmptyString(buildId) ? buildId : currentBuildId;

    // A live-build write (no buildId provided) needs a configured current build
    // to target. Surface the missing-build deployment state as a client-visible
    // 409, consistent with putTemplate, rather than an opaque 500.
    if (!isNonEmptyString(effectiveBuildId)) {
        throw new ConflictError('A current build id is required before includes can be published.', {
            code: 'CurrentBuildIdRequired',
        });
    }

    const service = context.getService('Hyperview');

    try {
        // Live-build include edits are only visible after the owning page is
        // re-PUT with a bumped version because includes cache by page version.
        const written = await service.putIncludeContent(context, effectiveBuildId, pathname, filename, source);
        return {
            filepath: written.filepath,
            buildId: effectiveBuildId,
        };
    } catch (cause) {
        throw new AssertionError('Unexpected error while writing include content', { cause });
    }
}
