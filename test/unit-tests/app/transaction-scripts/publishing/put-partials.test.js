import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { putPartials } from '../../../../../src/app/transaction-scripts/publishing/put-partials.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putPartials Transaction Script', ({ it }) => {
    it('requires a target build id before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putPartials(harness.context, {
            partials: [ { filepath: 'nav.html', source: '<nav/>' } ],
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('BuildIdRequired', caught.code);
        assertEqual(400, caught.httpStatusCode);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.putPartials.length);
    });

    it('rejects invalid and reserved target Build IDs before accessing Hyperview', async () => {
        for (const [ buildId, code ] of [ [ 'build/child', 'InvalidBuildId' ], [ 'dev', 'ReservedBuildId' ] ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => putPartials(harness.context, {
                buildId,
                partials: [],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(code, caught.code);
            assertEqual(0, harness.calls.serviceAccess);
            assertEqual(0, harness.calls.putPartials.length);
        }
    });

    it('refuses to write into the current build before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putPartials(harness.context, {
            buildId: CURRENT_BUILD_ID,
            partials: [],
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.putPartials.length);
    });

    it('delegates once to HyperviewService.putPartials and returns its result', async () => {
        const harness = makeHarness();
        const partials = [
            { filepath: 'nav.html', source: '<nav/>' },
            { filepath: 'footer.html', source: '<footer/>' },
        ];

        const result = await putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials,
        });

        assertEqual(1, harness.calls.serviceAccess);
        assertEqual('Hyperview', harness.calls.serviceNames[0]);
        assertEqual(1, harness.calls.putPartials.length);
        assertEqual(harness.context, harness.calls.putPartials[0].context);
        assertEqual(TARGET_BUILD_ID, harness.calls.putPartials[0].buildId);
        assertEqual(partials, harness.calls.putPartials[0].partials);
        assertEqual(2, result.length);
        assertEqual('partials/nav.html', result[0].filepath);
        assertEqual('partials/footer.html', result[1].filepath);
    });

    it('accepts and forwards an empty partial set', async () => {
        const harness = makeHarness();

        const result = await putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials: [],
        });

        assertEqual(1, harness.calls.putPartials.length);
        assertEqual(0, harness.calls.putPartials[0].partials.length);
        assertEqual(0, result.length);
    });

    it('allows the first deployment to stage partials without a current build', async () => {
        const harness = makeHarness({ currentBuildId: null });

        await putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials: [],
        });

        assertEqual(1, harness.calls.putPartials.length);
    });

    it('translates an expected store failure into an OperationalError, preserving cause', async () => {
        const cause = Object.assign(new Error('template file store unavailable'), { expected: true });
        const harness = makeHarness({ writeError: cause });

        const caught = await catchAsyncError(() => putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials: [],
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('OperationalError', caught.name);
        assertEqual(cause, caught.cause);
        assertMatches('Failed to publish the partial template set', caught.message);
    });

    it('propagates an AssertionError from the store unchanged', async () => {
        const cause = new Error('canonical filepath assertion failed');
        cause.name = 'AssertionError';
        const harness = makeHarness({ writeError: cause });

        const caught = await catchAsyncError(() => putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials: [],
        }));

        assertEqual(cause, caught);
    });

    it('propagates a native programmer error from the store unchanged', async () => {
        const cause = new TypeError('cannot read property of undefined');
        const harness = makeHarness({ writeError: cause });

        const caught = await catchAsyncError(() => putPartials(harness.context, {
            buildId: TARGET_BUILD_ID,
            partials: [],
        }));

        assertEqual(cause, caught);
    });
});

function makeHarness(options) {
    const {
        currentBuildId = CURRENT_BUILD_ID,
        writeError = null,
    } = options ?? {};

    const calls = {
        putPartials: [],
        serviceAccess: 0,
        serviceNames: [],
    };

    const service = {
        async putPartials(writeContext, buildId, partials) {
            calls.putPartials.push({ context: writeContext, buildId, partials });
            if (writeError) {
                throw writeError;
            }
            return partials.map(({ filepath }) => ({ filepath: `partials/${ filepath }` }));
        },
    };

    const context = {
        runtime: {
            build: currentBuildId ? { id: currentBuildId } : null,
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
