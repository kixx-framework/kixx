import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    BUILD_ASSIGNMENT_INTENTS,
    assignReleaseThroughGates,
    findBuildAssignmentProblems,
    findReleaseProvenanceProblems,
} from '../../../kixx/publish-gates/mod.js';
import {
    catchError,
    createTestRelease,
    makeHarness,
    removeHarnesses,
} from '../publishing-api/publishing-api-harness.js';


const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const SHA256_COMMIT = 'c'.repeat(64);
const FINGERPRINT = `kxfp1:${ '1'.repeat(64) }`;
const OTHER_FINGERPRINT = `kxfp1:${ '2'.repeat(64) }`;
const CODE = { revision: COMMIT, fingerprint: FINGERPRINT };
const ACTOR = { type: 'user', id: 'user-1', name: 'Ada' };

const PRODUCTION = { isDevelopment: false };
const DEVELOPMENT = { isDevelopment: true };

function prestage(fields = {}) {
    return { intent: 'prestage', sourceRevision: COMMIT, code: CODE, ...fields };
}

function publish(fields = {}) {
    return { intent: 'publish', sourceRevision: COMMIT, codeFingerprint: FINGERPRINT, ...fields };
}

function sources(problems) {
    return problems.map((problem) => problem.source).join(',');
}

// Writing a Release syncs blobs to disk, so every test shares one store with
// two Releases. Each test gets its own build id.
let sharedSetup = null;
let buildCount = 0;

async function setup() {
    sharedSetup ??= (async () => {
        const harness = await makeHarness();
        const release = await createTestRelease(harness.context, harness.service, 'gates first');
        const next = await createTestRelease(harness.context, harness.service, 'gates next');
        return { ...harness, releaseId: release.releaseId, nextReleaseId: next.releaseId };
    })();

    buildCount += 1;
    return { ...await sharedSetup, buildId: `gated-${ buildCount }` };
}

function gate({ context, service, buildId }, assignment, options = PRODUCTION) {
    return assignReleaseThroughGates(context, service, buildId, assignment, options);
}

// Pre-stages a build with CODE, as a deploy would.
async function prestageBuild(subject, releaseId = subject.releaseId) {
    return await gate(subject, { ...prestage(), releaseId, expectedAssignmentId: null, reason: 'carry-forward', actor: ACTOR });
}

async function history({ context, service, buildId }) {
    return (await service.listActivations(context, { buildId })).items;
}


describe('publish gates', ({ after, describe }) => {

    after(removeHarnesses);

    describe('BUILD_ASSIGNMENT_INTENTS', ({ it }) => {
        it('names the pre-stage and content-only publish intents', () => {
            assertEqual('prestage,publish', [ ...BUILD_ASSIGNMENT_INTENTS ].join(','));
        });
    });

    describe('findBuildAssignmentProblems', ({ it }) => {
        it('accepts a complete pre-stage and a complete content-only publish', () => {
            assertEqual(0, findBuildAssignmentProblems(prestage(), PRODUCTION).length);
            assertEqual(0, findBuildAssignmentProblems(publish(), PRODUCTION).length);
            assertEqual(0, findBuildAssignmentProblems(publish({ sourceRevision: SHA256_COMMIT }), PRODUCTION).length);
        });

        it('requires code and sourceRevision on a pre-stage outside development', () => {
            const problems = findBuildAssignmentProblems({ intent: 'prestage' }, PRODUCTION);
            assertEqual('sourceRevision,code', sources(problems));
        });

        it('requires sourceRevision and codeFingerprint on a content-only publish outside development', () => {
            const problems = findBuildAssignmentProblems({ intent: 'publish' }, PRODUCTION);
            assertEqual('sourceRevision,codeFingerprint', sources(problems));
        });

        it('requires nothing new in development', () => {
            assertEqual(0, findBuildAssignmentProblems({ intent: 'prestage' }, DEVELOPMENT).length);
            assertEqual(0, findBuildAssignmentProblems({ intent: 'publish' }, DEVELOPMENT).length);
        });

        it('treats null as absent', () => {
            const problems = findBuildAssignmentProblems({ intent: 'publish', sourceRevision: null, codeFingerprint: null }, DEVELOPMENT);
            assertEqual(0, problems.length);
        });

        it('requires a known intent in every environment', () => {
            assertEqual('intent', sources(findBuildAssignmentProblems({}, DEVELOPMENT)));
            assertEqual('intent', sources(findBuildAssignmentProblems({ intent: 'deploy' }, DEVELOPMENT)));
            assertEqual('intent', sources(findBuildAssignmentProblems({ intent: 'deploy' }, PRODUCTION)));
        });

        const malformed = [
            [ 'a non-hex sourceRevision', publish({ sourceRevision: 'g'.repeat(40) }), 'sourceRevision' ],
            [ 'a short sourceRevision', publish({ sourceRevision: 'a'.repeat(39) }), 'sourceRevision' ],
            [ 'an uppercase sourceRevision', publish({ sourceRevision: 'A'.repeat(40) }), 'sourceRevision' ],
            [ 'a non-string sourceRevision', publish({ sourceRevision: 42 }), 'sourceRevision' ],
            [ 'a bad codeFingerprint', publish({ codeFingerprint: 'kxfp1:abc' }), 'codeFingerprint' ],
            [ 'an unversioned codeFingerprint', publish({ codeFingerprint: '1'.repeat(64) }), 'codeFingerprint' ],
            [ 'code that is not an object', prestage({ code: 'abc' }), 'code' ],
            [ 'code without a fingerprint', prestage({ code: { revision: COMMIT } }), 'code.fingerprint' ],
            [ 'code without a revision', prestage({ code: { fingerprint: FINGERPRINT } }), 'code.revision' ],
            [ 'code with an extra key', prestage({ code: { ...CODE, branch: 'main' } }), 'code.branch' ],
            [ 'code with a bad revision', prestage({ code: { ...CODE, revision: 'main' } }), 'code.revision' ],
            [ 'code with a bad fingerprint', prestage({ code: { ...CODE, fingerprint: 'x' } }), 'code.fingerprint' ],
            [ 'code on a content-only publish', publish({ code: CODE }), 'code' ],
            [ 'codeFingerprint on a pre-stage', prestage({ codeFingerprint: FINGERPRINT }), 'codeFingerprint' ],
            [ 'an empty summary', publish({ summary: '' }), 'summary' ],
            [ 'a non-string summary', publish({ summary: 7 }), 'summary' ],
            [ 'an over-long summary', publish({ summary: 's'.repeat(2001) }), 'summary' ],
            [ 'a non-boolean force', publish({ force: 'yes' }), 'force' ],
            [ 'force without forceReason', publish({ force: true }), 'forceReason' ],
            [ 'forceReason without force', publish({ forceReason: 'Because.' }), 'forceReason' ],
            [ 'forceReason with force: false', publish({ force: false, forceReason: 'Because.' }), 'forceReason' ],
            [ 'an empty forceReason', publish({ force: true, forceReason: '' }), 'forceReason' ],
            [ 'an over-long forceReason', publish({ force: true, forceReason: 'r'.repeat(2001) }), 'forceReason' ],
        ];

        for (const [ name, assignment, source ] of malformed) {
            it(`refuses ${ name } in both environments`, () => {
                assertEqual(source, sources(findBuildAssignmentProblems(assignment, PRODUCTION)), 'production');
                assertEqual(source, sources(findBuildAssignmentProblems(assignment, DEVELOPMENT)), 'development');
            });
        }

        it('accepts the longest summary and forceReason', () => {
            const assignment = publish({ summary: 's'.repeat(2000), force: true, forceReason: 'r'.repeat(2000) });
            assertEqual(0, findBuildAssignmentProblems(assignment, PRODUCTION).length);
        });
    });

    describe('findReleaseProvenanceProblems', ({ it }) => {
        it('requires sourceRevision outside development', () => {
            assertEqual('provenance.sourceRevision', sources(findReleaseProvenanceProblems({}, PRODUCTION)));
            assertEqual('provenance.sourceRevision', sources(findReleaseProvenanceProblems(undefined, PRODUCTION)));
            assertEqual(0, findReleaseProvenanceProblems({ sourceRevision: COMMIT }, PRODUCTION).length);
            assertEqual(0, findReleaseProvenanceProblems({ sourceRevision: SHA256_COMMIT }, PRODUCTION).length);
        });

        it('accepts a missing sourceRevision in development', () => {
            assertEqual(0, findReleaseProvenanceProblems({}, DEVELOPMENT).length);
        });

        it('checks a present sourceRevision in both environments', () => {
            for (const options of [ PRODUCTION, DEVELOPMENT ]) {
                const problems = findReleaseProvenanceProblems({ sourceRevision: 'main' }, options);
                assertEqual('provenance.sourceRevision', sources(problems));
            }
        });
    });

    describe('assignReleaseThroughGates', ({ it }) => {
        it('pre-stages a new build with its code', async () => {
            const subject = await setup();
            const result = await prestageBuild(subject);

            assertEqual(subject.releaseId, result.releaseId);
            assertEqual(true, result.isChanged);
            assertEqual(JSON.stringify(CODE), JSON.stringify(result.code));
            const pointer = await subject.service.getBuildPointer(subject.context, subject.buildId);
            assertEqual(JSON.stringify(CODE), JSON.stringify(pointer.code));
        });

        it('treats a repeated pre-stage as unchanged', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);
            const again = await gate(subject, {
                ...prestage(),
                releaseId: subject.releaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'carry-forward',
                actor: ACTOR,
            });

            assertEqual(false, again.isChanged);
            assertEqual(first.assignmentId, again.assignmentId);
            assertEqual(1, (await history(subject)).length);
        });

        it('refuses a pre-stage with different code with BuildCodeMismatch', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);
            const error = await catchError(() => gate(subject, {
                ...prestage({ code: { revision: OTHER_COMMIT, fingerprint: OTHER_FINGERPRINT } }),
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            }));

            assertEqual('BuildCodeMismatch', error?.code);
            assertEqual(409, error.httpStatusCode);
            const pointer = await subject.service.getBuildPointer(subject.context, subject.buildId);
            assertEqual(subject.releaseId, pointer.rootHash);
        });

        it('publishes content with a matching fingerprint and records the activation', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);
            const result = await gate(subject, {
                ...publish({ sourceRevision: OTHER_COMMIT, summary: 'New opening hours.', force: true, forceReason: 'Hotfix.' }),
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            });

            assertEqual(subject.nextReleaseId, result.releaseId);
            assertEqual(true, result.isChanged);
            // Content-only publishing never sends code, so the build's stays.
            assertEqual(JSON.stringify(CODE), JSON.stringify(result.code));

            const [ newest ] = await history(subject);
            assertEqual(OTHER_COMMIT, newest.sourceRevision);
            assertEqual('New opening hours.', newest.summary);
            assertEqual('Hotfix.', newest.forceReason);
            assertEqual('user-1', newest.actor.id);
        });

        it('records no forceReason without force', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);
            await gate(subject, {
                ...publish(),
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            });

            const [ newest ] = await history(subject);
            assertEqual(null, newest.forceReason);
            assertEqual(null, newest.summary);
        });

        it('never sends code to the store on a content-only publish', async () => {
            const subject = await setup();
            await prestageBuild(subject);
            let received = null;
            const store = {
                getBuildPointer: (...args) => subject.service.getBuildPointer(...args),
                assignRelease: async (_context, _buildId, assignment) => {
                    received = assignment;
                    return {};
                },
            };
            await assignReleaseThroughGates(subject.context, store, subject.buildId, {
                ...publish(),
                releaseId: subject.nextReleaseId,
                reason: 'publish',
                actor: ACTOR,
            }, PRODUCTION);

            assertEqual('releaseId,reason,actor,sourceRevision', Object.keys(received).join(','));
        });

        it('refuses a content-only publish to a missing build with BuildNotFound', async () => {
            const subject = await setup();
            const error = await catchError(() => gate(subject, {
                ...publish(),
                releaseId: subject.releaseId,
                expectedAssignmentId: null,
                reason: 'publish',
                actor: ACTOR,
            }));

            assertEqual('BuildNotFound', error?.code);
            assertEqual(404, error.httpStatusCode);
            assertEqual(null, await subject.service.getBuildPointer(subject.context, subject.buildId));
        });

        it('refuses a content-only publish to a build without code outside development', async () => {
            const subject = await setup();
            const first = await gate(subject, {
                intent: 'prestage',
                releaseId: subject.releaseId,
                expectedAssignmentId: null,
                reason: 'publish',
                actor: ACTOR,
            }, DEVELOPMENT);

            const error = await catchError(() => gate(subject, {
                ...publish(),
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            }));

            assertEqual('BuildCodeUnknown', error?.code);
            assertEqual(409, error.httpStatusCode);
            const pointer = await subject.service.getBuildPointer(subject.context, subject.buildId);
            assertEqual(subject.releaseId, pointer.rootHash);
            assertEqual(1, (await history(subject)).length);
        });

        it('lets a content-only publish to a build without code proceed in development', async () => {
            const subject = await setup();
            const first = await gate(subject, {
                intent: 'prestage',
                releaseId: subject.releaseId,
                expectedAssignmentId: null,
                reason: 'publish',
                actor: ACTOR,
            }, DEVELOPMENT);

            const result = await gate(subject, {
                ...publish(),
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            }, DEVELOPMENT);

            assertEqual(subject.nextReleaseId, result.releaseId);
            assertEqual(null, result.code);
        });

        it('refuses a different fingerprint with CodeFingerprintMismatch, even with force', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);

            for (const options of [ PRODUCTION, DEVELOPMENT ]) {
                const error = await catchError(() => gate(subject, {
                    ...publish({ codeFingerprint: OTHER_FINGERPRINT, force: true, forceReason: 'Emergency.' }),
                    releaseId: subject.nextReleaseId,
                    expectedAssignmentId: first.assignmentId,
                    reason: 'rollback',
                    actor: ACTOR,
                }, options));

                assertEqual('CodeFingerprintMismatch', error?.code);
                assertEqual(409, error.httpStatusCode);
                assert(error.message.includes(FINGERPRINT), 'names the build fingerprint');
                assert(error.message.includes(OTHER_FINGERPRINT), 'names the commit fingerprint');
            }

            const pointer = await subject.service.getBuildPointer(subject.context, subject.buildId);
            assertEqual(subject.releaseId, pointer.rootHash);
            assertEqual(1, (await history(subject)).length);
        });

        it('skips the comparison in development when the request has no fingerprint', async () => {
            const subject = await setup();
            const first = await prestageBuild(subject);
            const result = await gate(subject, {
                intent: 'publish',
                releaseId: subject.nextReleaseId,
                expectedAssignmentId: first.assignmentId,
                reason: 'publish',
                actor: ACTOR,
            }, DEVELOPMENT);

            assertEqual(subject.nextReleaseId, result.releaseId);
        });

        it('throws InvalidBuildAssignment for gate problems and writes nothing', async () => {
            const subject = await setup();
            const error = await catchError(() => gate(subject, {
                intent: 'prestage',
                releaseId: subject.releaseId,
                expectedAssignmentId: null,
                reason: 'publish',
                actor: ACTOR,
            }));

            assertEqual('InvalidBuildAssignment', error?.code);
            assertEqual(422, error.httpStatusCode);
            assertEqual('sourceRevision,code', error.errors.map((entry) => entry.source).join(','));
            assertEqual(null, await subject.service.getBuildPointer(subject.context, subject.buildId));
        });

        it('asserts the fields the caller owns', async () => {
            const subject = await setup();
            const base = { ...prestage(), releaseId: subject.releaseId, reason: 'publish', actor: ACTOR };
            const cases = [
                { ...base, releaseId: 'nope' },
                { ...base, expectedAssignmentId: 'nope' },
                { ...base, reason: 'because' },
                { ...base, actor: null },
                { ...base, misspelled: true },
            ];

            for (const assignment of cases) {
                const error = await catchError(() => gate(subject, assignment));
                assertEqual('AssertionError', error?.name);
            }
            const error = await catchError(() => gate(subject, base, {}));
            assertEqual('AssertionError', error?.name);
        });
    });
});
