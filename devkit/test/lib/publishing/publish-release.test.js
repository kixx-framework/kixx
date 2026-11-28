import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import publishRelease, { PROVENANCE_CLIENT } from '../../../lib/publishing/publish-release.js';
import { UnsupportedServerError } from '../../../lib/publishing/negotiate-capabilities.js';

const CLIENT = { name: 'fake-client' };
const COMPILATION = { objects: [], release: { manifest: {} }, report: { problems: [], unmatchedFiles: [] } };
const EXPECTED = Object.freeze({ contentContractVersion: 2, addressingFormat: 4 });
const serializeContentObject = () => '';


describe('publishRelease()', ({ it }) => {

    it('compiles, publishes with provenance, assigns, and returns the assignment id', async () => {
        const calls = [];
        const result = await publishRelease(makeArgs({ calls }));

        assertEqual('compile,publish,assign', calls.join(','));
        assert(calls.publishArgs.compilation === COMPILATION, 'passes the compilation on');
        assert(calls.publishArgs.serializeContentObject === serializeContentObject, 'passes the serializer on');
        assert(calls.publishArgs.expected === EXPECTED, 'passes the expected versions to the publish');
        assert(calls.assignArgs.expected === EXPECTED, 'passes the expected versions to the assignment');
        assertEqual('kixx-dev', PROVENANCE_CLIENT);
        assertEqual('kixx-dev', calls.provenance.client);
        assertEqual('build-1', calls.provenance.intendedForBuildId);
        assertEqual(CLIENT, calls.assignArgs.client);
        assertEqual('build-1', calls.assignArgs.buildId);
        assertEqual('release-1', calls.assignArgs.releaseId);
        assertEqual('publish', calls.assignArgs.reason);
        assertEqual('release-1', result.releaseId);
        assertEqual('build-1', result.buildId);
        assertEqual('assignment-1', result.assignmentId);
    });

    it('never assigns on a dry run', async () => {
        const calls = [];
        const result = await publishRelease(makeArgs({ calls, dryRun: true }));

        assertEqual('compile,publish', calls.join(','));
        assertEqual(true, calls.dryRun);
        assertEqual(undefined, result.assignmentId);
        assertEqual('build-1', result.buildId);
    });

    it('requires a compile function', async () => {
        const calls = [];
        const error = await catchAsyncError(() => publishRelease({ ...makeArgs({ calls }), compile: undefined }));

        assertEqual('AssertionError', error?.name);
        assertEqual('', calls.join(','));
    });

    it('lets a refused compilation through, and assigns nothing', async () => {
        const calls = [];
        const failure = new Error('The content has problems');
        const error = await catchAsyncError(() => publishRelease({
            ...makeArgs({ calls }),
            publishContent: async () => {
                throw failure;
            },
        }));

        assert(error === failure, 'expected the original error');
        assertEqual('compile', calls.join(','));
    });

    it('rethrows UnsupportedServerError unwrapped', async () => {
        const failure = new UnsupportedServerError('too old');
        const error = await catchAsyncError(() => publishRelease(makeArgs({
            calls: [],
            assignRelease: async () => {
                throw failure;
            },
        })));

        assert(error === failure, 'expected the original error');
    });

    it('wraps other assignment failures with the recovery line', async () => {
        const cause = new Error('pointer moved');
        const error = await catchAsyncError(() => publishRelease(makeArgs({
            calls: [],
            assignRelease: async () => {
                throw cause;
            },
            formatRecovery: ({ releaseId, buildId }) => `Recover ${ releaseId } ${ buildId }`,
        })));

        assertEqual('ReleaseAssignmentError', error?.name);
        assertEqual('release-1', error.releaseId);
        assertEqual('build-1', error.buildId);
        assert(error.cause === cause, 'expected the cause');
        assertEqual(
            'Release "release-1" was created but could not be assigned to build "build-1": pointer moved\n'
            + 'Recover release-1 build-1',
            error.message,
        );
    });

    it('omits the recovery line without formatRecovery', async () => {
        const error = await catchAsyncError(() => publishRelease(makeArgs({
            calls: [],
            assignRelease: async () => {
                throw new Error('pointer moved');
            },
        })));

        assertEqual('ReleaseAssignmentError', error?.name);
        assertEqual(
            'Release "release-1" was created but could not be assigned to build "build-1": pointer moved',
            error.message,
        );
    });
});


function makeArgs(args) {
    const { calls, dryRun = false, assignRelease, formatRecovery } = args;

    return {
        client: CLIENT,
        buildId: 'build-1',
        dryRun,
        formatRecovery,
        serializeContentObject,
        expected: EXPECTED,
        compile: async () => {
            calls.push('compile');
            return COMPILATION;
        },
        publishContent: async (options) => {
            calls.push('publish');
            calls.publishArgs = options;
            calls.provenance = options.provenance;
            calls.dryRun = options.dryRun;
            return { dryRun: options.dryRun, releaseId: options.dryRun ? undefined : 'release-1' };
        },
        assignRelease: assignRelease ?? (async (options) => {
            calls.push('assign');
            calls.assignArgs = options;
            return { assignmentId: 'assignment-1' };
        }),
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
