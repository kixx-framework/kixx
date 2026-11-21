import { AssertionError } from '../../../kixx/errors/mod.js';
import { assertNonEmptyString } from '../../../kixx/assertions/mod.js';
import { validateReleaseProvenance } from '../../collections/release-record.js';


/**
 * Creates and verifies a Release, preserving the first audit record for its content id.
 * @param {import('../../../kixx/context/request-context.js').default} context - Active request context.
 * @param {Object} args - Release creation arguments.
 * @param {Object} args.manifest - Complete Release manifest.
 * @param {string} args.createdBy - Publishing token id.
 * @param {Object} [args.provenance] - Optional immutable publishing provenance.
 * @returns {Promise<Object>} Stored Release audit metadata.
 * @throws {ValidationError} When the manifest or provenance is invalid.
 * @throws {AssertionError} When an unexpected persistence failure occurs.
 */
export async function createRelease(context, args) {
    const { manifest, createdBy, provenance = {} } = args ?? {};
    assertNonEmptyString(createdBy, 'createRelease: createdBy');
    validateReleaseProvenance(provenance);

    const store = context.getService('ContentAddressableStore');
    const releases = context.getCollection('Release');
    const release = await store.createRelease(context, manifest);

    try {
        const record = await releases.create(context, {
            id: release.releaseId,
            releaseId: release.releaseId,
            createdAt: new Date().toISOString(),
            createdBy,
            objectCount: release.objectCount,
            totalBytes: release.totalBytes,
            contractVersion: release.contractVersion,
            provenance,
        });
        return record.toObject();
    } catch (cause) {
        if (cause.name === 'ValidationError') {
            throw cause;
        }
        if (cause.name === 'DocumentAlreadyExistsError') {
            const record = await releases.get(context, release.releaseId);
            if (record) {
                return record.toObject();
            }
        }
        throw new AssertionError('Unexpected error while recording a Release', { cause });
    }
}
