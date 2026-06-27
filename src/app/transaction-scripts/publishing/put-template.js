import { assert, isNonEmptyString } from '../../../kixx/assertions/mod.js';
import {
    AssertionError,
    BadRequestError,
    ConflictError,
} from '../../../kixx/errors/mod.js';


const TEMPLATE_KINDS = new Set([ 'base', 'page', 'partial' ]);


/**
 * Writes a template source file into a non-current build namespace.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Template write arguments.
 * @param {'base'|'page'|'partial'} args.kind - Template namespace to write.
 * @param {string} args.filepath - Logical template filepath.
 * @param {string} args.source - Template source text.
 * @param {string} args.buildId - Target build id.
 * @returns {Promise<{ filepath: string }>} Logical filepath written by Hyperview.
 * @throws {BadRequestError} When the source text or buildId is missing.
 * @throws {ConflictError} When buildId targets the current build.
 * @throws {AssertionError} When service writes unexpectedly fail.
 */
export async function putTemplate(context, args) {
    const {
        kind,
        filepath,
        source,
        buildId,
    } = args ?? {};

    assert(TEMPLATE_KINDS.has(kind), 'putTemplate() kind must be base, page, or partial');

    // An empty body is client input; reject it as a 400 here so it never reaches
    // the template file store, which treats a blank source as a broken invariant
    // (AssertionError -> 500).
    if (!isNonEmptyString(source)) {
        throw new BadRequestError('Template source text is required.', {
            code: 'TemplateSourceRequired',
        });
    }

    if (!isNonEmptyString(buildId)) {
        throw new BadRequestError('Kixx-Build-Id is required for template writes.', {
            code: 'BuildIdRequired',
        });
    }

    const currentBuildId = context.runtime.build?.id ?? null;

    if (!isNonEmptyString(currentBuildId)) {
        throw new ConflictError('A current build id is required before templates can be published.', {
            code: 'CurrentBuildIdRequired',
        });
    }

    if (buildId === currentBuildId) {
        throw new ConflictError('Template writes must target a build other than the current build.', {
            code: 'CurrentBuildWriteConflict',
        });
    }

    const service = context.getService('Hyperview');

    try {
        if (kind === 'base') {
            return await service.putBaseTemplate(context, buildId, filepath, source);
        }
        if (kind === 'page') {
            return await service.putPageTemplate(context, buildId, filepath, source);
        }
        return await service.putPartial(context, buildId, filepath, source);
    } catch (cause) {
        throw new AssertionError('Unexpected error while writing a template', { cause });
    }
}
