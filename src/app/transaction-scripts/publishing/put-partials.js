import { isNonEmptyString } from '../../../kixx/assertions/mod.js';
import {
    BadRequestError,
    ConflictError,
    OperationalError,
} from '../../../kixx/errors/mod.js';
import { validateBuildId } from '../../../kixx/utils/build-id.js';


/**
 * Replaces the complete partial template set for a target build's namespace.
 *
 * Delegates once to `HyperviewService.putPartials()`, which enforces the
 * canonical-filepath and live-build-protection invariants and owns the
 * complete-replacement contract at the store. This script owns only the
 * publishing-API-facing Build ID rules and translation of expected write
 * failures; it does not catch assertion or native programmer errors, which
 * propagate unchanged so they crash the process rather than being reframed as
 * an operational failure.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Partial set write arguments.
 * @param {string} args.buildId - Target build id.
 * @param {{filepath: string, source: string}[]} args.partials - Normalized, validated complete partial set.
 * @returns {Promise<{filepath: string}[]>} Logical, `partials/`-prefixed filepaths written, in submitted order.
 * @throws {BadRequestError} When buildId is missing or invalid.
 * @throws {ConflictError} When buildId targets the current build.
 * @throws {OperationalError} When the underlying template file store write unexpectedly fails.
 */
export async function putPartials(context, args) {
    const { buildId, partials } = args ?? {};

    if (!isNonEmptyString(buildId)) {
        throw new BadRequestError('Kixx-Build-Id is required for template writes.', {
            code: 'BuildIdRequired',
        });
    }

    validateBuildId(buildId);

    // A missing current build id means the site has never been deployed; the
    // first deploy must be able to stage its templates. The equality check below
    // still protects a live build once one exists, and is vacuously safe when
    // currentBuildId is null because a non-empty buildId can never equal null.
    const currentBuildId = context.runtime.build?.id ?? null;

    if (buildId === currentBuildId) {
        throw new ConflictError('Template writes must target a build other than the current build.', {
            code: 'CurrentBuildWriteConflict',
        });
    }

    const service = context.getService('Hyperview');

    try {
        return await service.putPartials(context, buildId, partials);
    } catch (cause) {
        // Only recognized expected failures (OperationalError and other
        // error.expected === true errors) are translated here; an AssertionError
        // or native programmer error propagates unchanged rather than being
        // caught by a catch-all wrapper, per the project error-handling rules.
        if (cause.expected) {
            throw new OperationalError('Failed to publish the partial template set', { cause });
        }
        throw cause;
    }
}
