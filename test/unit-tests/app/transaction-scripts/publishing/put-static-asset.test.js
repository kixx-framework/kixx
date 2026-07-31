import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { putStaticAsset } from '../../../../../src/app/transaction-scripts/publishing/put-static-asset.js';
import { computeStaticFileEtag } from '../../../../../src/kixx/static-file-server/static-file-etag.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putStaticAsset Transaction Script', ({ it }) => {
    it('rejects missing or empty source bytes before accessing the store', async () => {
        for (const body of [ null, new Uint8Array() ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
                filepath: 'images/logo.png',
                body,
                contentType: 'image/png',
                buildId: TARGET_BUILD_ID,
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('StaticAssetSourceRequired', caught.code);
            assertEqual(400, caught.httpStatusCode);
            assertEqual('Static asset source bytes are required.', caught.message);
            assertEqual(0, harness.calls.serviceAccess);
            assertEqual(0, harness.calls.write.length);
        }
    });

    it('requires a target build id before accessing the store', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body: new Uint8Array([ 1 ]),
            contentType: 'image/png',
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('BuildIdRequired', caught.code);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('Kixx-Build-Id is required for static asset writes.', caught.message);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.write.length);
    });

    it('rejects invalid and reserved target Build IDs before accessing the store', async () => {
        for (const [ buildId, code ] of [ [ 'build/child', 'InvalidBuildId' ], [ 'dev', 'ReservedBuildId' ] ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
                filepath: 'images/logo.png',
                body: new Uint8Array([ 1 ]),
                contentType: 'image/png',
                buildId,
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(code, caught.code);
            assertEqual(0, harness.calls.serviceAccess);
            assertEqual(0, harness.calls.write.length);
        }
    });

    it('refuses to write into the current build before accessing the store', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body: new Uint8Array([ 1 ]),
            contentType: 'image/png',
            buildId: CURRENT_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(
            'Static asset writes must target a build other than the current build.',
            caught.message,
        );
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, harness.calls.read.length);
        assertEqual(0, harness.calls.write.length);
    });

    it('writes asset bytes into the target build namespace', async () => {
        const body = new Uint8Array([ 1, 2, 3 ]);
        const harness = makeHarness();
        const result = await putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body,
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        });
        const call = harness.calls.write[0];
        const readCall = harness.calls.read[0];

        assertEqual(1, harness.calls.serviceAccess);
        assertEqual('StaticFileStore', harness.calls.serviceNames[0]);
        assertEqual(1, harness.calls.read.length);
        assertEqual(harness.context, readCall.context);
        assertEqual('images/logo.png', readCall.options.key);
        assertEqual(TARGET_BUILD_ID, readCall.options.namespace);
        assertEqual(true, readCall.options.computeEtag);
        assertEqual(1, harness.calls.write.length);
        assertEqual(harness.context, call.context);
        assertEqual('images/logo.png', call.options.key);
        assertEqual(TARGET_BUILD_ID, call.options.namespace);
        assertEqual(body, call.options.body);
        assertEqual('image/png', call.options.contentType);
        assertEqual('images/logo.png', result.filepath);
        assertEqual(TARGET_BUILD_ID, result.buildId);
        assertEqual('image/png', result.contentType);
        assertEqual(3, result.contentLength);
        assertEqual('"asset-etag"', result.etag);
    });

    it('allows the first deployment to stage an asset without a current build', async () => {
        const harness = makeHarness({ currentBuildId: null });
        const result = await putStaticAsset(harness.context, {
            filepath: 'styles/site.css',
            body: new Uint8Array([ 1 ]),
            contentType: 'text/css',
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(1, harness.calls.write.length);
        assertEqual(TARGET_BUILD_ID, result.buildId);
    });

    it('returns an identical existing asset without writing and cancels its body', async () => {
        const body = new Uint8Array([ 1, 2, 3 ]);
        const etag = await computeStaticFileEtag(body);
        const existing = makeExistingAsset({
            contentType: 'image/png',
            contentLength: body.byteLength,
            etag,
        });
        const harness = makeHarness({ readResult: existing.result });

        const result = await putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body,
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(1, existing.cancelCount());
        assertEqual(0, harness.calls.write.length);
        assertEqual('images/logo.png', result.filepath);
        assertEqual('image/png', result.contentType);
        assertEqual(3, result.contentLength);
        assertEqual(etag, result.etag);
    });

    it('returns an identical existing asset with no body without writing', async () => {
        const body = new Uint8Array([ 1, 2, 3 ]);
        const etag = await computeStaticFileEtag(body);
        const harness = makeHarness({
            readResult: {
                body: null,
                contentType: 'image/png',
                contentLength: body.byteLength,
                etag,
                lastModified: null,
            },
        });

        const result = await putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body,
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(0, harness.calls.write.length);
        assertEqual('images/logo.png', result.filepath);
        assertEqual(etag, result.etag);
    });

    it('rejects changed bytes, content type, length, or missing ETag without writing', async () => {
        const body = new Uint8Array([ 1, 2, 3 ]);
        const etag = await computeStaticFileEtag(body);
        const scenarios = [
            { etag: await computeStaticFileEtag(new Uint8Array([ 3, 2, 1 ])), contentLength: 3, contentType: 'image/png' },
            { etag, contentLength: 3, contentType: 'application/octet-stream' },
            { etag, contentLength: 4, contentType: 'image/png' },
            { etag: null, contentLength: 3, contentType: 'image/png' },
        ];

        for (const scenario of scenarios) {
            const existing = makeExistingAsset(scenario);
            const harness = makeHarness({ readResult: existing.result });
            const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
                filepath: 'images/logo.png',
                body,
                contentType: 'image/png',
                buildId: TARGET_BUILD_ID,
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('ConflictError', caught.name);
            assertEqual('StaticAssetImmutableConflict', caught.code);
            assertEqual(409, caught.httpStatusCode);
            assertEqual(1, existing.cancelCount());
            assertEqual(0, harness.calls.write.length);
        }
    });

    it('wraps store write failures as unexpected errors with their cause', async () => {
        const cause = new Error('static file store unavailable');
        const harness = makeHarness({ writeError: cause });
        const caught = await catchAsyncError(() => putStaticAsset(harness.context, {
            filepath: 'images/logo.png',
            body: new Uint8Array([ 1 ]),
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while writing a static asset', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.write.length);
    });

    it('wraps read and body cancellation failures as unexpected errors with their cause', async () => {
        const readCause = new Error('static file store unavailable');
        const readHarness = makeHarness({ readError: readCause });
        const readCaught = await catchAsyncError(() => putStaticAsset(readHarness.context, {
            filepath: 'images/logo.png',
            body: new Uint8Array([ 1 ]),
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        }));
        assertEqual('AssertionError', readCaught.name);
        assertEqual('Unexpected error while reading an existing static asset', readCaught.message);
        assertEqual(readCause, readCaught.cause);

        const cancelCause = new Error('stream cancellation failed');
        const existing = makeExistingAsset({ cancelError: cancelCause });
        const cancelHarness = makeHarness({ readResult: existing.result });
        const cancelCaught = await catchAsyncError(() => putStaticAsset(cancelHarness.context, {
            filepath: 'images/logo.png',
            body: new Uint8Array([ 1 ]),
            contentType: 'image/png',
            buildId: TARGET_BUILD_ID,
        }));
        assertEqual('AssertionError', cancelCaught.name);
        assertEqual('Unexpected error while cancelling an existing static asset body', cancelCaught.message);
        assertEqual(cancelCause, cancelCaught.cause);
        assertEqual(0, cancelHarness.calls.write.length);
    });
});

function makeHarness(options) {
    const {
        currentBuildId = CURRENT_BUILD_ID,
        readResult = null,
        readError = null,
        writeError = null,
    } = options ?? {};
    const calls = {
        serviceAccess: 0,
        serviceNames: [],
        read: [],
        write: [],
    };
    const store = {
        async read(context, readOptions) {
            calls.read.push({ context, options: readOptions });
            if (readError) {
                throw readError;
            }
            return readResult;
        },
        async write(context, writeOptions) {
            calls.write.push({ context, options: writeOptions });
            if (writeError) {
                throw writeError;
            }
            return {
                key: writeOptions.key,
                contentType: writeOptions.contentType,
                contentLength: writeOptions.body.byteLength,
                etag: '"asset-etag"',
            };
        },
    };
    const context = {
        runtime: {
            build: { id: currentBuildId },
        },
        getService(name) {
            calls.serviceAccess += 1;
            calls.serviceNames.push(name);
            return store;
        },
    };

    return { context, calls };
}

function makeExistingAsset(options) {
    const {
        contentType = 'image/png',
        contentLength = 1,
        etag = '"asset-etag"',
        cancelError = null,
    } = options ?? {};
    let cancelCount = 0;

    return {
        result: {
            body: {
                async cancel() {
                    cancelCount += 1;
                    if (cancelError) {
                        throw cancelError;
                    }
                },
            },
            contentType,
            contentLength,
            etag,
            lastModified: null,
        },
        cancelCount() {
            return cancelCount;
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
