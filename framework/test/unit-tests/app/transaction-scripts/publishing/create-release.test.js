import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createRelease } from '../../../../../src/app/transaction-scripts/publishing/create-release.js';


function makeContext() {
    const calls = [];
    let serviceCallCount = 0;
    const existing = { toObject: () => ({ id: 'release-1', createdBy: 'first-token' }) };
    const releases = {
        async create(_context, attributes) {
            calls.push(attributes);
            if (calls.length > 1) {
                const error = new Error('duplicate');
                error.name = 'DocumentAlreadyExistsError';
                throw error;
            }
            return existing;
        },
        async get() {
            return existing;
        },
    };
    const store = {
        async createRelease() {
            serviceCallCount += 1;
            return {
                releaseId: 'release-1',
                objectCount: 3,
                totalBytes: 100,
                contractVersion: 1,
            };
        },
    };
    return {
        calls,
        get serviceCallCount() {
            return serviceCallCount;
        },
        getService: () => store,
        getCollection: () => releases,
    };
}

describe('createRelease', ({ it }) => {

    it('preserves the first record when identical content is recreated', async () => {
        const context = makeContext();
        const first = await createRelease(context, {
            manifest: {},
            createdBy: 'first-token',
            provenance: { message: 'first' },
        });
        const second = await createRelease(context, {
            manifest: {},
            createdBy: 'second-token',
            provenance: { message: 'second' },
        });

        assertEqual('first-token', first.createdBy);
        assertEqual('first-token', second.createdBy);
        assertEqual(2, context.calls.length);
    });

    it('rejects unknown provenance before creating content', async () => {
        const context = makeContext();
        let error;
        try {
            await createRelease(context, {
                manifest: {},
                createdBy: 'token-1',
                provenance: { branch: 'main' },
            });
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual(0, context.calls.length);
        assertEqual(0, context.serviceCallCount);
    });
});
