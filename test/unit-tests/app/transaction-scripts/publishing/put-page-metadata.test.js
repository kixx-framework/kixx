import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { putPageMetadata } from '../../../../../src/app/transaction-scripts/publishing/put-page-metadata.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putPageMetadata Transaction Script', ({ it }) => {
    it('defaults an omitted build id to the current build', async () => {
        const metadata = { version: 'page-v2', title: 'Home' };
        const harness = makeHarness();
        const result = await putPageMetadata(harness.context, {
            pathname: '/',
            metadata,
        });
        const call = harness.calls.putPageMetadata[0];

        assertEqual(1, harness.calls.serviceAccess);
        assertEqual('Hyperview', harness.calls.serviceNames[0]);
        assertEqual(1, harness.calls.putPageMetadata.length);
        assertEqual(harness.context, call.context);
        assertEqual(CURRENT_BUILD_ID, call.buildId);
        assertEqual('/', call.pathname);
        assertEqual(metadata, call.metadata);
        assertEqual('/page.json', result.filepath);
        assertEqual(CURRENT_BUILD_ID, result.buildId);
    });

    it('writes to an explicitly selected build instead of the current build', async () => {
        const metadata = { version: 'page-v3' };
        const harness = makeHarness({ writtenFilepath: '/blog/page.json' });
        const result = await putPageMetadata(harness.context, {
            pathname: '/blog',
            metadata,
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(TARGET_BUILD_ID, harness.calls.putPageMetadata[0].buildId);
        assertEqual('/blog/page.json', result.filepath);
        assertEqual(TARGET_BUILD_ID, result.buildId);
    });

    it('rejects invalid and reserved effective Build IDs before accessing Hyperview', async () => {
        for (const [ buildId, code ] of [ [ 'build/child', 'InvalidBuildId' ], [ 'dev', 'ReservedBuildId' ] ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => putPageMetadata(harness.context, {
                pathname: '/',
                metadata: { version: 'page-v2' },
                buildId,
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(code, caught.code);
            assertEqual(0, harness.calls.serviceAccess);
            assertEqual(0, harness.calls.putPageMetadata.length);
        }
    });

    it('reports a missing effective build id before accessing Hyperview', async () => {
        const harness = makeHarness({ currentBuildId: null });
        const caught = await catchAsyncError(() => putPageMetadata(harness.context, {
            pathname: '/',
            metadata: { version: 'page-v2' },
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildIdRequired', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(
            'A current build id is required before pages can be published.',
            caught.message,
        );
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.putPageMetadata.length);
    });

    it('wraps Hyperview write failures as unexpected errors with their cause', async () => {
        const cause = new Error('page data store unavailable');
        const harness = makeHarness({ writeError: cause });
        const caught = await catchAsyncError(() => putPageMetadata(harness.context, {
            pathname: '/',
            metadata: { version: 'page-v2' },
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while writing page metadata', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.putPageMetadata.length);
    });
});

function makeHarness(options) {
    const {
        currentBuildId = CURRENT_BUILD_ID,
        writeError = null,
        writtenFilepath = '/page.json',
    } = options ?? {};
    const calls = {
        putPageMetadata: [],
        serviceAccess: 0,
        serviceNames: [],
    };
    const service = {
        async putPageMetadata(context, buildId, pathname, metadata) {
            calls.putPageMetadata.push({
                context,
                buildId,
                pathname,
                metadata,
            });
            if (writeError) {
                throw writeError;
            }
            return { filepath: writtenFilepath };
        },
    };
    const context = {
        runtime: {
            build: { id: currentBuildId },
        },
        getService(name) {
            calls.serviceAccess += 1;
            calls.serviceNames.push(name);
            return service;
        },
    };

    return { context, calls };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
