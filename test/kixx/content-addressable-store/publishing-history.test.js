import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    ACTIVATION_REASONS,
    ACTOR_TYPES,
    HISTORY_LIMITS,
    decodeHistoryCursor,
    encodeHistoryCursor,
    normalizeActivation,
    normalizeActor,
    normalizeCodeInfo,
    normalizeHistoryPage,
    normalizeReleaseInput,
    validateReleaseProvenance,
} from '../../../kixx/content-addressable-store/publishing-history.js';


const LABEL = 'Store#method: value';
const SHORT = 'a'.repeat(256);
const TOO_SHORT = 'a'.repeat(257);
const LONG = 'a'.repeat(2000);
const TOO_LONG = 'a'.repeat(2001);

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Every port-contract violation is an AssertionError naming the value.
function assertRejected(fn) {
    const error = catchError(fn);

    assert(error, 'expected an error to be thrown');
    assertEqual('AssertionError', error.name);
    assert(error.message.startsWith(LABEL), `message starts with the label: ${ error.message }`);
}

function makeActor(overrides) {
    return { type: 'user', id: 'user-1', ...overrides };
}

function makeActivation(overrides) {
    return { reason: 'publish', actor: makeActor(), ...overrides };
}

function makeRelease(overrides) {
    return {
        releaseId: 'release-1',
        createdBy: makeActor(),
        objectCount: 2,
        totalBytes: 42,
        contractVersion: 2,
        provenance: {},
        ...overrides,
    };
}


describe('publishing history constants', ({ it }) => {
    it('holds exactly the four activation reasons', () => {
        assertEqual('carry-forward,publish,restore,rollback', [ ...ACTIVATION_REASONS ].sort().join(','));
    });

    it('holds exactly the two actor types', () => {
        assertEqual('deploy-key,user', [ ...ACTOR_TYPES ].sort().join(','));
    });

    it('freezes the history limits', () => {
        assert(Object.isFrozen(HISTORY_LIMITS));
        assertEqual(
            JSON.stringify({ shortTextLength: 256, longTextLength: 2000, pageSize: 100 }),
            JSON.stringify(HISTORY_LIMITS),
        );
    });
});

describe('validateReleaseProvenance()', ({ it }) => {
    it('accepts empty provenance and each known field', () => {
        assertEqual(undefined, validateReleaseProvenance({}));
        assertEqual(undefined, validateReleaseProvenance({ sourceRevision: 'abc123' }));
        assertEqual(undefined, validateReleaseProvenance({ message: 'Publish home page' }));
        assertEqual(undefined, validateReleaseProvenance({ client: 'kixx-cli/1' }));
        assertEqual(undefined, validateReleaseProvenance({ intendedForBuildId: 'build-2' }));
    });

    it('accepts a value exactly at each cap', () => {
        assertEqual(undefined, validateReleaseProvenance({
            sourceRevision: SHORT,
            message: LONG,
            client: SHORT,
            intendedForBuildId: SHORT,
        }));
    });

    it('reports every unknown provenance field', () => {
        const error = catchError(() => validateReleaseProvenance({ branch: 'main', environment: 'production' }));

        assertEqual('ValidationError', error.name);
        assertEqual('Invalid Release provenance', error.message);
        assertEqual(2, error.errors.length);
        assertEqual('provenance.branch', error.errors[0].source);
        assertEqual('provenance.environment', error.errors[1].source);
    });

    it('rejects a value which is not a plain object', () => {
        for (const value of [ undefined, null, 'text', [], new Map() ]) {
            const error = catchError(() => validateReleaseProvenance(value));

            assertEqual('ValidationError', error.name);
            assertEqual(1, error.errors.length);
            assertEqual('provenance', error.errors[0].source);
        }
    });

    it('rejects an empty string and a non-string', () => {
        const error = catchError(() => validateReleaseProvenance({ sourceRevision: '', client: 42 }));

        assertEqual('ValidationError', error.name);
        assertEqual('provenance.sourceRevision,provenance.client', error.errors.map(({ source }) => source).join(','));
    });

    it('reports each field over its cap', () => {
        const error = catchError(() => validateReleaseProvenance({
            sourceRevision: TOO_SHORT,
            message: TOO_LONG,
            client: TOO_SHORT,
            intendedForBuildId: TOO_SHORT,
        }));

        assertEqual('ValidationError', error.name);
        assertEqual(
            'provenance.sourceRevision,provenance.message,provenance.client,provenance.intendedForBuildId',
            error.errors.map(({ source }) => source).join(','),
        );
    });
});

describe('normalizeActor()', ({ it }) => {
    it('accepts both types, with and without a name', () => {
        assertEqual(
            JSON.stringify({ type: 'user', id: 'user-1', name: 'Ada' }),
            JSON.stringify(normalizeActor({ type: 'user', id: 'user-1', name: 'Ada' }, LABEL)),
        );
        assertEqual(
            JSON.stringify({ type: 'deploy-key', id: 'key-1', name: null }),
            JSON.stringify(normalizeActor({ type: 'deploy-key', id: 'key-1' }, LABEL)),
        );
        assertEqual(null, normalizeActor({ type: 'user', id: SHORT, name: null }, LABEL).name);
        assertEqual(SHORT, normalizeActor({ type: 'user', id: 'user-1', name: SHORT }, LABEL).name);
    });

    it('returns a new object and leaves its argument alone', () => {
        const actor = Object.freeze({ type: 'user', id: 'user-1' });

        const result = normalizeActor(actor, LABEL);

        assert(result !== actor);
        assertEqual(false, Object.hasOwn(actor, 'name'));
    });

    it('rejects a malformed actor', () => {
        assertRejected(() => normalizeActor(undefined, LABEL));
        assertRejected(() => normalizeActor('user-1', LABEL));
        assertRejected(() => normalizeActor({ id: 'user-1' }, LABEL));
        assertRejected(() => normalizeActor({ type: 'robot', id: 'user-1' }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user' }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user', id: '' }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user', id: TOO_SHORT }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user', id: 'user-1', name: '' }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user', id: 'user-1', name: TOO_SHORT }, LABEL));
        assertRejected(() => normalizeActor({ type: 'user', id: 'user-1', email: 'a@example.com' }, LABEL));
    });
});

describe('normalizeActivation()', ({ it }) => {
    it('accepts every audit reason', () => {
        for (const reason of [ 'publish', 'rollback', 'carry-forward', 'restore' ]) {
            assertEqual(reason, normalizeActivation(makeActivation({ reason }), LABEL).reason);
        }
    });

    it('rejects an unknown audit reason', () => {
        assertRejected(() => normalizeActivation(makeActivation({ reason: 'deploy' }), LABEL));
        assertRejected(() => normalizeActivation({ actor: makeActor() }, LABEL));
    });

    it('returns null for each absent optional field', () => {
        const result = normalizeActivation(makeActivation({ summary: undefined, forceReason: null }), LABEL);

        assertEqual(
            JSON.stringify({
                reason: 'publish',
                actor: { type: 'user', id: 'user-1', name: null },
                sourceRevision: null,
                summary: null,
                forceReason: null,
            }),
            JSON.stringify(result),
        );
    });

    it('keeps every field given, up to its cap', () => {
        const result = normalizeActivation(makeActivation({
            reason: 'rollback',
            actor: { type: 'deploy-key', id: 'key-1', name: 'CI' },
            sourceRevision: SHORT,
            summary: LONG,
            forceReason: LONG,
        }), LABEL);

        assertEqual('rollback', result.reason);
        assertEqual('CI', result.actor.name);
        assertEqual(SHORT, result.sourceRevision);
        assertEqual(LONG, result.summary);
        assertEqual(LONG, result.forceReason);
    });

    it('rejects a malformed activation', () => {
        assertRejected(() => normalizeActivation(undefined, LABEL));
        assertRejected(() => normalizeActivation({ reason: 'publish' }, LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ actor: makeActor({ type: 'robot' }) }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ sourceRevision: '' }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ sourceRevision: TOO_SHORT }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ summary: '' }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ summary: TOO_LONG }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ forceReason: '' }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ forceReason: TOO_LONG }), LABEL));
        assertRejected(() => normalizeActivation(makeActivation({ forceReson: 'typo' }), LABEL));
    });
});

describe('normalizeCodeInfo()', ({ it }) => {
    it('returns null when no code info is given', () => {
        assertEqual(null, normalizeCodeInfo(undefined, LABEL));
        assertEqual(null, normalizeCodeInfo(null, LABEL));
    });

    it('returns a copy holding both values', () => {
        const code = { revision: 'abc123', fingerprint: SHORT };

        const result = normalizeCodeInfo(code, LABEL);

        assert(result !== code);
        assertEqual(JSON.stringify(code), JSON.stringify(result));
    });

    it('rejects malformed code info', () => {
        assertRejected(() => normalizeCodeInfo('abc123', LABEL));
        assertRejected(() => normalizeCodeInfo({ revision: 'abc123' }, LABEL));
        assertRejected(() => normalizeCodeInfo({ fingerprint: 'f1' }, LABEL));
        assertRejected(() => normalizeCodeInfo({ revision: '', fingerprint: 'f1' }, LABEL));
        assertRejected(() => normalizeCodeInfo({ revision: TOO_SHORT, fingerprint: 'f1' }, LABEL));
        assertRejected(() => normalizeCodeInfo({ revision: 'abc123', fingerprint: TOO_SHORT }, LABEL));
        assertRejected(() => normalizeCodeInfo({ revision: 'abc123', fingerprint: 'f1', branch: 'main' }, LABEL));
    });
});

describe('normalizeReleaseInput()', ({ it }) => {
    it('returns a normalized copy', () => {
        const release = makeRelease({ objectCount: 0, totalBytes: 0, provenance: { sourceRevision: 'abc123' } });

        const result = normalizeReleaseInput(release, LABEL);

        assert(result !== release);
        assert(result.provenance !== release.provenance);
        assertEqual(
            JSON.stringify({
                releaseId: 'release-1',
                createdBy: { type: 'user', id: 'user-1', name: null },
                objectCount: 0,
                totalBytes: 0,
                contractVersion: 2,
                provenance: { sourceRevision: 'abc123' },
            }),
            JSON.stringify(result),
        );
    });

    it('rejects a malformed Release', () => {
        assertRejected(() => normalizeReleaseInput(undefined, LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ releaseId: '' }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ createdBy: 'user-1' }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ createdBy: undefined }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ objectCount: -1 }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ objectCount: 1.5 }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ totalBytes: '42' }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ contractVersion: 0 }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ createdAt: '2026-11-25T00:00:00.000Z' }), LABEL));
    });

    it('reports invalid provenance as a contract violation', () => {
        assertRejected(() => normalizeReleaseInput(makeRelease({ provenance: undefined }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ provenance: { branch: 'main' } }), LABEL));
        assertRejected(() => normalizeReleaseInput(makeRelease({ provenance: { message: TOO_LONG } }), LABEL));
    });
});

describe('normalizeHistoryPage()', ({ it }) => {
    it('defaults to the first page of 100', () => {
        assertEqual(JSON.stringify({ limit: 100, cursor: null }), JSON.stringify(normalizeHistoryPage(undefined, LABEL)));
        assertEqual(JSON.stringify({ limit: 100, cursor: null }), JSON.stringify(normalizeHistoryPage({}, LABEL)));
        assertEqual(null, normalizeHistoryPage({ cursor: null }, LABEL).cursor);
    });

    it('accepts a limit from 1 to 100 and a cursor', () => {
        assertEqual(1, normalizeHistoryPage({ limit: 1 }, LABEL).limit);
        assertEqual(100, normalizeHistoryPage({ limit: 100 }, LABEL).limit);
        assertEqual('42', normalizeHistoryPage({ cursor: '42' }, LABEL).cursor);
    });

    it('rejects a limit outside the range or of the wrong type', () => {
        for (const limit of [ 0, 101, 1.5, '10', null, NaN ]) {
            assertRejected(() => normalizeHistoryPage({ limit }, LABEL));
        }
    });

    it('rejects a malformed cursor, a non-object, and an unknown key', () => {
        assertRejected(() => normalizeHistoryPage({ cursor: '' }, LABEL));
        assertRejected(() => normalizeHistoryPage({ cursor: 42 }, LABEL));
        assertRejected(() => normalizeHistoryPage('42', LABEL));
        assertRejected(() => normalizeHistoryPage({ limt: 10 }, LABEL));
    });
});

describe('history cursors', ({ it }) => {
    it('round-trips a sequence', () => {
        assertEqual(1, decodeHistoryCursor(encodeHistoryCursor(1)));
        assertEqual(Number.MAX_SAFE_INTEGER, decodeHistoryCursor(encodeHistoryCursor(Number.MAX_SAFE_INTEGER)));
        assertEqual('42', encodeHistoryCursor(42));
    });

    it('rejects a malformed cursor as a bad request, without echoing it', () => {
        const malformed = [
            '0',
            '-1',
            '1.5',
            '01',
            'abc',
            ' 7',
            '12345678901234567',
            '9007199254740992',
            '',
            undefined,
            null,
            42,
            {},
        ];

        for (const cursor of malformed) {
            const error = catchError(() => decodeHistoryCursor(cursor));

            assert(error, `expected an error for ${ String(cursor) }`);
            assertEqual('BadRequestError', error.name);
            assertEqual('InvalidCursor', error.code);
            assertEqual(400, error.httpStatusCode);
            assertEqual(true, error.expected);
            assertEqual('The cursor is invalid.', error.message);
        }
    });
});
