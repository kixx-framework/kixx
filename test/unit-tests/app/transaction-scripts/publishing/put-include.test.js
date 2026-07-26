import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { putInclude } from '../../../../../src/app/transaction-scripts/publishing/put-include.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putInclude Transaction Script', ({ it }) => {
    it('rejects missing source text before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putInclude(harness.context, {
            pathname: '/blog',
            filename: 'body.md',
            source: '',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('IncludeSourceRequired', caught.code);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('Include source text is required.', caught.message);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.putIncludeContent.length);
    });

    it('defaults an omitted build id to the current build', async () => {
        const harness = makeHarness();
        const result = await putInclude(harness.context, {
            pathname: '/blog',
            filename: 'body.md',
            source: 'Published body',
        });
        const call = harness.calls.putIncludeContent[0];

        assertEqual(1, harness.calls.serviceAccess);
        assertEqual('Hyperview', harness.calls.serviceNames[0]);
        assertEqual(1, harness.calls.putIncludeContent.length);
        assertEqual(harness.context, call.context);
        assertEqual(CURRENT_BUILD_ID, call.buildId);
        assertEqual('/blog', call.pathname);
        assertEqual('body.md', call.filename);
        assertEqual('Published body', call.source);
        assertEqual('/blog/body.md', result.filepath);
        assertEqual(CURRENT_BUILD_ID, result.buildId);
    });

    it('writes to an explicitly selected build instead of the current build', async () => {
        const harness = makeHarness();
        const result = await putInclude(harness.context, {
            pathname: '/',
            filename: 'summary.md',
            source: 'Staged summary',
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(TARGET_BUILD_ID, harness.calls.putIncludeContent[0].buildId);
        assertEqual(TARGET_BUILD_ID, result.buildId);
    });

    it('reports a missing effective build id before accessing Hyperview', async () => {
        const harness = makeHarness({ currentBuildId: null });
        const caught = await catchAsyncError(() => putInclude(harness.context, {
            pathname: '/blog',
            filename: 'body.md',
            source: 'Published body',
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildIdRequired', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(
            'A current build id is required before includes can be published.',
            caught.message,
        );
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.putIncludeContent.length);
    });

    it('wraps Hyperview write failures as unexpected errors with their cause', async () => {
        const cause = new Error('page data store unavailable');
        const harness = makeHarness({ writeError: cause });
        const caught = await catchAsyncError(() => putInclude(harness.context, {
            pathname: '/blog',
            filename: 'body.md',
            source: 'Published body',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while writing include content', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.putIncludeContent.length);
    });
});

function makeHarness(options) {
    const {
        currentBuildId = CURRENT_BUILD_ID,
        writeError = null,
        writtenFilepath = '/blog/body.md',
    } = options ?? {};
    const calls = {
        putIncludeContent: [],
        serviceAccess: 0,
        serviceNames: [],
    };
    const service = {
        async putIncludeContent(context, buildId, pathname, filename, source) {
            calls.putIncludeContent.push({
                context,
                buildId,
                pathname,
                filename,
                source,
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
