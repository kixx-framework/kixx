/**
 * Publish compiled content as a Release and assign it to a build pointer.
 * @module publishing/publish-release
 */

import defaultAssignRelease from './assign-release.js';
import defaultPublishContent from './publish-content.js';
import { UnsupportedServerError } from './negotiate-capabilities.js';
import { assertFunction } from '../vendor/kixx-assert/mod.js';

/**
 * A Release that was created successfully but could not be assigned to a
 * build pointer. Carries the Release id so an operator can complete the
 * assignment separately instead of losing track of already-written content.
 * Not a `UsageError`, because the runner wraps those and would break the
 * copyable recovery command.
 */
export class ReleaseAssignmentError extends Error {

    /**
     * @param {string} message - Operator-facing failure description
     * @param {Object} options - Failure details
     * @param {string} options.releaseId - Release that was created
     * @param {string} options.buildId - Build pointer that was not assigned
     * @param {Error} options.cause - Underlying assignment failure
     */
    constructor(message, options) {
        const { releaseId, buildId, cause } = options ?? {};

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
            releaseId: {
                enumerable: true,
                value: releaseId,
            },
            buildId: {
                enumerable: true,
                value: buildId,
            },
        });
    }
}

/**
 * The `client` value of a Release's provenance.
 * @type {string}
 */
export const PROVENANCE_CLIENT = 'kixx-dev';

/**
 * Compiles the project's content, publishes it as a Release, and assigns the
 * Release to the build unless this is a dry run.
 *
 * The devkit holds no content compiler. The caller passes `compile`, which
 * runs the project's own (`compileProjectContent()` from the project's
 * tooling), with that tooling's `serializeContentObject()` and the contract
 * versions it composes.
 * @param {Object} args - Publish inputs
 * @param {Object} args.client - Publishing API client
 * @param {function(): Promise<Object>} args.compile - Resolves what the project's `compileProjectContent()` resolves
 * @param {function(Object): (string|ArrayBuffer)} args.serializeContentObject - The project's serializer for an object's upload body
 * @param {Object} args.expected - The contract versions the project's Kixx composes; see `negotiateCapabilities()`
 * @param {string} args.buildId - Build pointer to assign
 * @param {boolean} [args.dryRun=false] - Preview without writes
 * @param {Function} [args.publishContent] - Release publisher
 * @param {Function} [args.assignRelease] - Build pointer assigner
 * @param {function({releaseId: string, buildId: string}): string} [args.formatRecovery]
 *     Returns the recovery line appended to an assignment failure
 * @returns {Promise<Object>} `publishContent()` result plus `buildId` and `assignmentId`
 * @throws {UsageError} When the compilation has problems
 * @throws {UnsupportedServerError} When the server does not serve the assignment protocol
 * @throws {ReleaseAssignmentError} When the Release was created but not assigned
 */
export default async function publishRelease(args) {
    const {
        client,
        compile,
        serializeContentObject,
        expected,
        buildId,
        dryRun = false,
        publishContent = defaultPublishContent,
        assignRelease = defaultAssignRelease,
        formatRecovery,
    } = args ?? {};

    assertFunction(compile, 'publishRelease() requires a compile function');

    const compilation = await compile();

    const result = await publishContent({
        client,
        compilation,
        serializeContentObject,
        expected,
        dryRun,
        provenance: { client: PROVENANCE_CLIENT, intendedForBuildId: buildId },
    });

    let assignment;

    if (!result.dryRun) {
        try {
            assignment = await assignRelease({
                client,
                buildId,
                releaseId: result.releaseId,
                expected,
                reason: 'publish',
            });
        } catch (cause) {
            // An incompatible server is refused before the assignment is
            // attempted, so there is no half-finished publish to recover.
            if (cause instanceof UnsupportedServerError) {
                throw cause;
            }

            // The Release already exists on the server at this point.
            // Reporting only the assignment failure would hide that and
            // strand the operator without the id needed to recover.
            const { releaseId } = result;
            let message = `Release "${ releaseId }" was created but could not be assigned to ` +
                `build "${ buildId }": ${ cause.message }`;

            if (formatRecovery) {
                message += `\n${ formatRecovery({ releaseId, buildId }) }`;
            }

            throw new ReleaseAssignmentError(message, { releaseId, buildId, cause });
        }
    }

    return { ...result, buildId, assignmentId: assignment?.assignmentId };
}
