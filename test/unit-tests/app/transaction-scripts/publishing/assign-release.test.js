import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { assignRelease } from '../../../../../src/app/transaction-scripts/publishing/assign-release.js';
import { ConflictError, NotFoundError, OperationalError } from '../../../../../src/kixx/errors/mod.js';


function makeContext(options) {
    const calls = [];
    const errors = [];
    const store = {
        getBuildPointer() {
            throw new Error('transaction script must not read the pointer');
        },
        async assignRelease() {
            return options?.pointer ?? {
                buildId: 'build-1',
                releaseId: 'release-new',
                assignedAt: '2026-09-01T12:00:00.000Z',
                assignmentId: crypto.randomUUID(),
                isChanged: true,
                previousReleaseId: 'release-old',
            };
        },
    };
    const activations = {
        async append(_context, attributes) {
            calls.push(attributes);
            if (options?.failHistory) {
                throw new OperationalError('history unavailable');
            }
            if (options?.failUnexpectedly) {
                throw new TypeError('broken audit record');
            }
        },
    };
    return {
        calls,
        errors,
        getService: () => store,
        getCollection: () => activations,
        logger: {
            error(...args) {
                errors.push(args);
            },
        },
    };
}

describe('assignRelease', ({ it }) => {

    it('records the prior and resulting Releases', async () => {
        const context = makeContext();
        const result = await assignRelease(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: crypto.randomUUID(),
            activatedBy: 'token-1',
            reason: 'rollback',
        });

        assertEqual('release-new', result.releaseId);
        assertEqual('release-old', context.calls[0].fromReleaseId);
        assertEqual('release-new', context.calls[0].toReleaseId);
        assertEqual('2026-09-01T12:00:00.000Z', context.calls[0].activatedAt);
        assertEqual('rollback', context.calls[0].reason);
    });

    it('keeps the pointer result authoritative when history storage fails', async () => {
        const context = makeContext({ failHistory: true });
        const result = await assignRelease(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            expectedAssignmentId: crypto.randomUUID(),
            activatedBy: 'token-1',
            reason: 'publish',
        });

        assertEqual('release-new', result.releaseId);
        assertEqual(1, context.errors.length);
        assertEqual('failed to record Release activation', context.errors[0][0]);
        assertEqual('release-old', context.errors[0][1].fromReleaseId);
        assertEqual('2026-09-01T12:00:00.000Z', context.errors[0][1].activatedAt);
    });

    it('does not read a pointer or append an activation for a valid no-op', async () => {
        const context = makeContext({ pointer: {
            buildId: 'build-1',
            releaseId: 'release-current',
            assignedAt: '2020-01-01T00:00:00.000Z',
            assignmentId: crypto.randomUUID(),
            isChanged: false,
            previousReleaseId: 'release-current',
        } });

        const result = await assignRelease(context, {
            buildId: 'build-1', releaseId: 'release-current', expectedAssignmentId: crypto.randomUUID(), activatedBy: 'token-1', reason: 'publish',
        });

        assertEqual('2020-01-01T00:00:00.000Z', result.assignedAt);
        assertEqual(0, context.calls.length);
    });

    it('propagates unexpected activation failures', async () => {
        const context = makeContext({ failUnexpectedly: true });
        let caught = null;
        try {
            await assignRelease(context, {
                buildId: 'build-1', releaseId: 'release-new', expectedAssignmentId: crypto.randomUUID(), activatedBy: 'token-1', reason: 'publish',
            });
        } catch (error) {
            caught = error;
        }

        assert(caught);
        assertEqual('TypeError', caught.name);
        assertEqual(0, context.errors.length);
    });

    it('does not append an activation when assignment fails', async () => {
        for (const error of [
            new ConflictError('stale', { code: 'BuildPointerConflict' }),
            new NotFoundError('missing', { code: 'ReleaseNotFound' }),
        ]) {
            const context = makeContext();
            context.getService = () => ({
                async assignRelease() {
                    throw error;
                },
            });

            let caught = null;
            try {
                await assignRelease(context, {
                    buildId: 'build-1', releaseId: 'release-new', expectedAssignmentId: crypto.randomUUID(), activatedBy: 'token-1', reason: 'publish',
                });
            } catch (cause) {
                caught = cause;
            }
            assertEqual(error, caught);
            assertEqual(0, context.calls.length);
        }
    });

    it('lets a later publish proceed from the pointer identity after history fails', async () => {
        // The pointer is authoritative: a missing Activation must not keep the
        // next publisher from using the identity it was handed.
        let pointer = {
            buildId: 'build-1',
            releaseId: 'release-old',
            assignedAt: '2026-09-01T12:00:00.000Z',
            assignmentId: crypto.randomUUID(),
            isChanged: true,
            previousReleaseId: null,
        };
        const store = {
            async assignRelease(_context, buildId, { releaseId, expectedAssignmentId }) {
                if (expectedAssignmentId !== pointer.assignmentId) {
                    throw new ConflictError('stale', { code: 'BuildPointerConflict' });
                }
                pointer = {
                    buildId,
                    releaseId,
                    assignedAt: '2026-09-01T12:05:00.000Z',
                    assignmentId: crypto.randomUUID(),
                    isChanged: true,
                    previousReleaseId: pointer.releaseId,
                };
                return pointer;
            },
        };
        const context = makeContext({ failHistory: true });
        context.getService = () => store;

        const first = await assignRelease(context, {
            buildId: 'build-1', releaseId: 'release-old', expectedAssignmentId: pointer.assignmentId, activatedBy: 'token-1', reason: 'publish',
        });
        const second = await assignRelease(context, {
            buildId: 'build-1', releaseId: 'release-new', expectedAssignmentId: first.assignmentId, activatedBy: 'token-1', reason: 'publish',
        });

        assertEqual('release-new', second.releaseId);
        assertEqual('release-old', second.previousReleaseId);
        assertEqual(2, context.errors.length);
    });
});
