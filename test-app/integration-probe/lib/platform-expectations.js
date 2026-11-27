// What each Cloudflare platform check should report, written from what the
// fakes in test/fakes/ do today. A unit test runs the checks against the
// fakes and compares with this; the Cloudflare integration test runs them
// against the platform and compares with this too. So a fake that differs
// from its platform is a named failing check. Fix the fake, then this, and
// pin the difference with a unit test (QA-2).
//
// An expectation holds:
// - `outcome`: `resolved` or `rejected`.
// - `value`: what a resolved check must report, compared as JSON.
// - `messageIncludes`: text a rejected check's message must hold. Only
//   where the platform's message is documented: the fakes' other messages
//   are their own.
// - `measurement`: true where the fake is stricter than the platform on
//   purpose. A different outcome on the platform is then reported, not
//   failed.
// - `documented`: whether Cloudflare's documentation settles the answer
//   (read 2026-11-27). Where it doesn't, the first run on Cloudflare does.

const TOO_BIG = Object.freeze({
    outcome: 'rejected',
    messageIncludes: 'SQLITE_TOOBIG',
    measurement: true,
    documented: false,
});

export const PLATFORM_EXPECTATIONS = Object.freeze({
    'kv-put-array-buffer-view': Object.freeze({
        outcome: 'resolved',
        value: Object.freeze({ storedBytes: Object.freeze([ 1, 2, 3 ]) }),
        documented: false,
    }),
    'kv-get-empty-array': Object.freeze({ outcome: 'rejected', documented: false }),
    'kv-put-expiration-and-ttl': Object.freeze({ outcome: 'rejected', documented: false }),
    'kv-put-expiration-under-60-seconds': Object.freeze({ outcome: 'rejected', documented: true }),
    'kv-put-twice-within-a-second': Object.freeze({
        outcome: 'rejected',
        messageIncludes: 'KV PUT failed: 429 Too Many Requests',
        documented: true,
    }),
    'environment-bindings': Object.freeze({
        outcome: 'resolved',
        value: Object.freeze({ missingFromRequest: Object.freeze([]), missingFromBoot: Object.freeze([]) }),
        documented: false,
    }),

    // The fake doesn't model a binding count that differs from the
    // placeholders: node:sqlite binds the missing one as NULL.
    'sql-too-few-bindings': Object.freeze({
        outcome: 'resolved',
        value: Object.freeze({ first: 'one', second: null }),
        documented: false,
    }),
    'sql-unsupported-binding-type': Object.freeze({ outcome: 'rejected', documented: false }),

    // S06 OP3: the fake keeps a 2,000,000-byte row limit, and the limits
    // page gives 8 MB. The platform's answers are the measurement.
    'sql-blob-2000001-bytes': TOO_BIG,
    'sql-blob-4194304-bytes': TOO_BIG,
    'sql-blob-8000000-bytes': TOO_BIG,
    'sql-blob-8388609-bytes': TOO_BIG,

    'sql-transaction-rollback': Object.freeze({
        outcome: 'resolved',
        value: Object.freeze({ thrown: 'rolled back on purpose', rowsAfterRollback: 0 }),
        documented: true,
    }),
});

export const PLATFORM_CHECK_NAMES = Object.freeze(Object.keys(PLATFORM_EXPECTATIONS));


/**
 * Compares what a check reported with what it should have.
 *
 * @param {string} name - A check's name
 * @param {Object} observation - What the check reported
 * @returns {string[]} Each difference, as a sentence. Empty when there is none.
 * @throws {Error} When no expectation has the name
 */
export function comparePlatformObservation(name, observation) {
    if (!Object.hasOwn(PLATFORM_EXPECTATIONS, name)) {
        throw new Error(`No platform expectation is named ${ name }`);
    }

    const expected = PLATFORM_EXPECTATIONS[name];
    const differences = [];

    if (observation?.outcome !== expected.outcome) {
        differences.push(`expected the call to be ${ expected.outcome }, and it was ${ describe(observation) }`);

        return differences;
    }

    if (expected.value !== undefined && JSON.stringify(observation.value) !== JSON.stringify(expected.value)) {
        differences.push(
            `expected the value ${ JSON.stringify(expected.value) }, got ${ JSON.stringify(observation.value) }`,
        );
    }

    if (expected.messageIncludes !== undefined && !String(observation.message).includes(expected.messageIncludes)) {
        differences.push(`expected a message holding "${ expected.messageIncludes }", got "${ observation.message }"`);
    }

    return differences;
}

function describe(observation) {
    if (observation?.outcome === 'rejected') {
        return `rejected (${ observation.errorName }: ${ observation.message })`;
    }

    if (observation?.outcome === 'resolved') {
        return `resolved (${ JSON.stringify(observation.value) })`;
    }

    return `not an observation (${ JSON.stringify(observation) })`;
}
