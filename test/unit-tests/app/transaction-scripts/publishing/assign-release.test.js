import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { assignRelease } from '../../../../../src/app/transaction-scripts/publishing/assign-release.js';


function makeContext(options) {
    const calls = [];
    const errors = [];
    const store = {
        async getBuildPointer() {
            return { rootHash: 'release-old', assignedAt: '2026-09-01T11:00:00.000Z' };
        },
        async assignRelease() {
            return { buildId: 'build-1', releaseId: 'release-new', assignedAt: '2026-09-01T12:00:00.000Z' };
        },
    };
    const activations = {
        async append(_context, attributes) {
            calls.push(attributes);
            if (options?.failHistory) {
                throw new Error('history unavailable');
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
            precondition: 'release-old',
            activatedBy: 'token-1',
            reason: 'rollback',
        });

        assertEqual('release-new', result.releaseId);
        assertEqual('release-old', context.calls[0].fromReleaseId);
        assertEqual('release-new', context.calls[0].toReleaseId);
        assertEqual('rollback', context.calls[0].reason);
    });

    it('keeps the pointer result authoritative when history storage fails', async () => {
        const context = makeContext({ failHistory: true });
        const result = await assignRelease(context, {
            buildId: 'build-1',
            releaseId: 'release-new',
            activatedBy: 'token-1',
            reason: 'publish',
        });

        assertEqual('release-new', result.releaseId);
        assertEqual(1, context.errors.length);
        assertEqual('failed to record Release activation', context.errors[0][0]);
    });
});
