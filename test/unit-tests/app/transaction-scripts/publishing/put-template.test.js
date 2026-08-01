import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { putTemplate } from '../../../../../src/app/transaction-scripts/publishing/put-template.js';


const CURRENT_BUILD_ID = 'build-current';
const TARGET_BUILD_ID = 'build-next';


describe('putTemplate Transaction Script', ({ it }) => {
    it('rejects an unsupported template kind before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putTemplate(harness.context, {
            kind: 'partial',
            filepath: 'website.html',
            source: '<html></html>',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertMatches('putTemplate() kind must be base or page', caught.message);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, getWriteCallCount(harness.calls));
    });

    it('rejects missing source text before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putTemplate(harness.context, {
            kind: 'base',
            filepath: 'website.html',
            source: '',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('TemplateSourceRequired', caught.code);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('Template source text is required.', caught.message);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, getWriteCallCount(harness.calls));
    });

    it('requires a target build id before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putTemplate(harness.context, {
            kind: 'page',
            filepath: 'home.html',
            source: '<h1>Home</h1>',
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('BadRequestError', caught.name);
        assertEqual('BuildIdRequired', caught.code);
        assertEqual(400, caught.httpStatusCode);
        assertEqual('Kixx-Build-Id is required for template writes.', caught.message);
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, getWriteCallCount(harness.calls));
    });

    it('rejects invalid and reserved target Build IDs before accessing Hyperview', async () => {
        for (const [ buildId, code ] of [ [ 'build/child', 'InvalidBuildId' ], [ 'dev', 'ReservedBuildId' ] ]) {
            const harness = makeHarness();
            const caught = await catchAsyncError(() => putTemplate(harness.context, {
                kind: 'page',
                filepath: 'home.html',
                source: '<h1>Home</h1>',
                buildId,
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual(code, caught.code);
            assertEqual(0, harness.calls.serviceAccess);
            assertEqual(0, getWriteCallCount(harness.calls));
        }
    });

    it('refuses to write into the current build before accessing Hyperview', async () => {
        const harness = makeHarness();
        const caught = await catchAsyncError(() => putTemplate(harness.context, {
            kind: 'page',
            filepath: 'card.html',
            source: '<article></article>',
            buildId: CURRENT_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('ConflictError', caught.name);
        assertEqual('CurrentBuildWriteConflict', caught.code);
        assertEqual(409, caught.httpStatusCode);
        assertEqual(
            'Template writes must target a build other than the current build.',
            caught.message,
        );
        assertEqual(0, harness.calls.serviceAccess);
        assertEqual(0, getWriteCallCount(harness.calls));
    });

    it('dispatches each supported template kind to its Hyperview write method', async () => {
        const scenarios = [
            { kind: 'base', method: 'putBaseTemplate' },
            { kind: 'page', method: 'putPageTemplate' },
        ];

        for (const { kind, method } of scenarios) {
            const harness = makeHarness();
            const result = await putTemplate(harness.context, {
                kind,
                filepath: 'nested/template.html',
                source: '<p>Template</p>',
                buildId: TARGET_BUILD_ID,
            });
            const call = harness.calls[method][0];

            assertEqual(1, harness.calls.serviceAccess);
            assertEqual('Hyperview', harness.calls.serviceNames[0]);
            assertEqual(1, getWriteCallCount(harness.calls));
            assertEqual(harness.context, call.context);
            assertEqual(TARGET_BUILD_ID, call.buildId);
            assertEqual('nested/template.html', call.filepath);
            assertEqual('<p>Template</p>', call.source);
            assertEqual(`${ kind }/nested/template.html`, result.filepath);
        }
    });

    it('allows the first deployment to stage a template without a current build', async () => {
        const harness = makeHarness({ currentBuildId: null });
        const result = await putTemplate(harness.context, {
            kind: 'base',
            filepath: 'website.html',
            source: '<html></html>',
            buildId: TARGET_BUILD_ID,
        });

        assertEqual(1, harness.calls.putBaseTemplate.length);
        assertEqual('base/website.html', result.filepath);
    });

    it('wraps Hyperview write failures as unexpected errors with their cause', async () => {
        const cause = new Error('template file store unavailable');
        const harness = makeHarness({ writeError: cause });
        const caught = await catchAsyncError(() => putTemplate(harness.context, {
            kind: 'page',
            filepath: 'home.html',
            source: '<h1>Home</h1>',
            buildId: TARGET_BUILD_ID,
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while writing a template', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.putPageTemplate.length);
    });
});

function makeHarness(options) {
    const {
        currentBuildId = CURRENT_BUILD_ID,
        writeError = null,
    } = options ?? {};
    const calls = {
        putBaseTemplate: [],
        putPageTemplate: [],
        serviceAccess: 0,
        serviceNames: [],
    };
    const service = {
        async putBaseTemplate(context, buildId, filepath, source) {
            return await write('base', 'putBaseTemplate', context, buildId, filepath, source);
        },
        async putPageTemplate(context, buildId, filepath, source) {
            return await write('page', 'putPageTemplate', context, buildId, filepath, source);
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

    async function write(kind, method, writeContext, buildId, filepath, source) {
        calls[method].push({
            context: writeContext,
            buildId,
            filepath,
            source,
        });
        if (writeError) {
            throw writeError;
        }
        return { filepath: `${ kind }/${ filepath }` };
    }
}

function getWriteCallCount(calls) {
    return calls.putBaseTemplate.length
        + calls.putPageTemplate.length;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
