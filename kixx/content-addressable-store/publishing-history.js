import { BadRequestError, ValidationError } from '../errors/mod.js';
import {
    assert,
    isNonEmptyString,
    isPlainObject,
    isString,
} from '../assertions/mod.js';


/**
 * Shared rules for publishing history: Release records, Activations, build
 * code info, and paging. Every content store adapter validates with these
 * functions, so the same bad input fails the same way on every platform.
 *
 * Each `normalize*` function takes the value and a `label` naming it, such as
 * `'NodeContentStore#assignBuild: assignment.activation'`. It throws an
 * `AssertionError` whose message starts with the label, rejects unknown keys
 * so a misspelled field is never silently dropped, and returns a new plain
 * object which is safe to pass across a process boundary.
 *
 * Optional text is `null` when absent. `undefined` and `null` both mean
 * absent; an empty string is rejected.
 * @module
 */


/**
 * Why a build's assignment changed.
 * @type {Set<string>}
 */
export const ACTIVATION_REASONS = new Set([ 'publish', 'rollback', 'carry-forward', 'restore' ]);

/**
 * Who can create a Release or change an assignment.
 * @type {Set<string>}
 */
export const ACTOR_TYPES = new Set([ 'deploy-key', 'user' ]);

/**
 * Text lengths are counted in UTF-16 code units (`string.length`). The caps
 * keep every stored history row small on every platform.
 * @type {{shortTextLength: number, longTextLength: number, pageSize: number}}
 */
export const HISTORY_LIMITS = Object.freeze({
    shortTextLength: 256,
    longTextLength: 2000,
    pageSize: 100,
});

const PROVENANCE_FIELD_LENGTHS = new Map([
    [ 'sourceRevision', HISTORY_LIMITS.shortTextLength ],
    [ 'message', HISTORY_LIMITS.longTextLength ],
    [ 'client', HISTORY_LIMITS.shortTextLength ],
    [ 'intendedForBuildId', HISTORY_LIMITS.shortTextLength ],
]);

const ACTOR_KEYS = [ 'type', 'id', 'name' ];
const ACTIVATION_KEYS = [ 'reason', 'actor', 'sourceRevision', 'summary', 'forceReason' ];
const CODE_INFO_KEYS = [ 'revision', 'fingerprint' ];
const RELEASE_KEYS = [ 'releaseId', 'createdBy', 'objectCount', 'totalBytes', 'contractVersion', 'provenance' ];
const HISTORY_PAGE_KEYS = [ 'limit', 'cursor' ];

// One to sixteen digits with no leading zero: every positive safe integer
// has this form, and nothing longer can be one.
const CURSOR_PATTERN = /^[1-9][0-9]{0,15}$/;


/**
 * Validates the optional provenance submitted with a Release.
 * @param {Object} provenance - Provenance submitted with a Release
 * @returns {void}
 * @throws {ValidationError} Listing every invalid or unknown field
 */
export function validateReleaseProvenance(provenance) {
    const error = new ValidationError('Invalid Release provenance');

    for (const problem of findProvenanceProblems(provenance)) {
        error.push(problem.message, problem.source);
    }

    if (error.length) {
        throw error;
    }
}

/**
 * @param {{type: string, id: string, name?: (string|null)}} actor - Who acted
 * @param {string} label - Names the value in assertion messages
 * @returns {{type: string, id: string, name: (string|null)}} A normalized copy
 * @throws {AssertionError} When the actor is malformed
 */
export function normalizeActor(actor, label) {
    assertPlainObjectWithKeys(actor, ACTOR_KEYS, label);
    assert(ACTOR_TYPES.has(actor.type), `${ label }.type must be one of: ${ [ ...ACTOR_TYPES ].join(', ') }`);

    return {
        type: actor.type,
        id: normalizeRequiredText(actor.id, HISTORY_LIMITS.shortTextLength, `${ label }.id`),
        name: normalizeOptionalText(actor.name, HISTORY_LIMITS.shortTextLength, `${ label }.name`),
    };
}

/**
 * @param {Object} activation - What to record when an assignment changes
 * @param {string} label - Names the value in assertion messages
 * @returns {{reason: string, actor: Object, sourceRevision: (string|null), summary: (string|null), forceReason: (string|null)}} A normalized copy
 * @throws {AssertionError} When the activation is malformed
 */
export function normalizeActivation(activation, label) {
    assertPlainObjectWithKeys(activation, ACTIVATION_KEYS, label);
    assert(
        ACTIVATION_REASONS.has(activation.reason),
        `${ label }.reason must be one of: ${ [ ...ACTIVATION_REASONS ].join(', ') }`,
    );

    return {
        reason: activation.reason,
        actor: normalizeActor(activation.actor, `${ label }.actor`),
        sourceRevision: normalizeOptionalText(
            activation.sourceRevision,
            HISTORY_LIMITS.shortTextLength,
            `${ label }.sourceRevision`,
        ),
        summary: normalizeOptionalText(activation.summary, HISTORY_LIMITS.longTextLength, `${ label }.summary`),
        forceReason: normalizeOptionalText(
            activation.forceReason,
            HISTORY_LIMITS.longTextLength,
            `${ label }.forceReason`,
        ),
    };
}

/**
 * @param {({revision: string, fingerprint: string}|null)} [code] - A build's code identity
 * @param {string} label - Names the value in assertion messages
 * @returns {({revision: string, fingerprint: string}|null)} A normalized copy, or `null` when absent
 * @throws {AssertionError} When code info is given but malformed
 */
export function normalizeCodeInfo(code, label) {
    if (code === undefined || code === null) {
        return null;
    }

    assertPlainObjectWithKeys(code, CODE_INFO_KEYS, label);

    return {
        revision: normalizeRequiredText(code.revision, HISTORY_LIMITS.shortTextLength, `${ label }.revision`),
        fingerprint: normalizeRequiredText(
            code.fingerprint,
            HISTORY_LIMITS.shortTextLength,
            `${ label }.fingerprint`,
        ),
    };
}

/**
 * @param {Object} release - The Release record to store, without its timestamp
 * @param {string} label - Names the value in assertion messages
 * @returns {{releaseId: string, createdBy: Object, objectCount: number, totalBytes: number, contractVersion: number, provenance: Object}} A normalized copy
 * @throws {AssertionError} When the record is malformed
 */
export function normalizeReleaseInput(release, label) {
    assertPlainObjectWithKeys(release, RELEASE_KEYS, label);
    assert(isNonEmptyString(release.releaseId), `${ label }.releaseId must be a non-empty string`);
    assertNonNegativeInteger(release.objectCount, `${ label }.objectCount`);
    assertNonNegativeInteger(release.totalBytes, `${ label }.totalBytes`);
    assert(
        Number.isSafeInteger(release.contractVersion) && release.contractVersion >= 1,
        `${ label }.contractVersion must be a positive integer`,
    );

    const [ problem ] = findProvenanceProblems(release.provenance);
    assert(!problem, `${ label }.provenance is invalid: ${ problem?.message }`);

    return {
        releaseId: release.releaseId,
        createdBy: normalizeActor(release.createdBy, `${ label }.createdBy`),
        objectCount: release.objectCount,
        totalBytes: release.totalBytes,
        contractVersion: release.contractVersion,
        provenance: { ...release.provenance },
    };
}

/**
 * @param {{limit?: number, cursor?: (string|null)}} [options] - Paging options
 * @param {string} label - Names the value in assertion messages
 * @returns {{limit: number, cursor: (string|null)}} A normalized copy
 * @throws {AssertionError} When an option is malformed
 */
export function normalizeHistoryPage(options, label) {
    const page = options ?? {};
    assertPlainObjectWithKeys(page, HISTORY_PAGE_KEYS, label);

    const limit = page.limit ?? HISTORY_LIMITS.pageSize;
    assert(
        page.limit !== null && Number.isInteger(limit) && limit >= 1 && limit <= HISTORY_LIMITS.pageSize,
        `${ label }.limit must be an integer from 1 to ${ HISTORY_LIMITS.pageSize }`,
    );

    const cursor = page.cursor ?? null;
    assert(cursor === null || isNonEmptyString(cursor), `${ label }.cursor must be a non-empty string`);

    return { limit, cursor };
}

/**
 * Makes the cursor that continues a history list after one row.
 * @param {number} sequence - Sequence of the last row on the page
 * @returns {string} A cursor callers treat as opaque
 */
export function encodeHistoryCursor(sequence) {
    return String(sequence);
}

/**
 * Reads a cursor made by `encodeHistoryCursor()`.
 *
 * Cursors come back from public requests, so a bad one is an expected input
 * error and not a programmer error. The message holds no part of the input.
 * @param {string} cursor - Cursor from an earlier page
 * @returns {number} The sequence to continue after
 * @throws {BadRequestError} With code `InvalidCursor` when the cursor is malformed
 */
export function decodeHistoryCursor(cursor) {
    const sequence = isString(cursor) && CURSOR_PATTERN.test(cursor) ? Number(cursor) : NaN;

    if (!Number.isSafeInteger(sequence)) {
        throw new BadRequestError('The cursor is invalid.', { code: 'InvalidCursor' });
    }

    return sequence;
}


function findProvenanceProblems(provenance) {
    if (!isPlainObject(provenance)) {
        return [ { message: 'Release provenance must be an object', source: 'provenance' } ];
    }

    const problems = [];

    for (const field of Object.keys(provenance)) {
        const source = `provenance.${ field }`;
        const maxLength = PROVENANCE_FIELD_LENGTHS.get(field);
        const value = provenance[field];

        if (maxLength === undefined) {
            problems.push({ message: `Unknown Release provenance field "${ field }"`, source });
        } else if (!isNonEmptyString(value)) {
            problems.push({ message: `Release provenance ${ field } must be a non-empty string`, source });
        } else if (value.length > maxLength) {
            problems.push({
                message: `Release provenance ${ field } must be at most ${ maxLength } characters`,
                source,
            });
        }
    }

    return problems;
}

function assertPlainObjectWithKeys(value, allowedKeys, label) {
    assert(isPlainObject(value), `${ label } must be a plain object`);

    for (const key of Object.keys(value)) {
        assert(allowedKeys.includes(key), `${ label } has an unknown key "${ key }"`);
    }
}

function assertNonNegativeInteger(value, label) {
    assert(Number.isSafeInteger(value) && value >= 0, `${ label } must be a non-negative integer`);
}

function normalizeRequiredText(value, maxLength, label) {
    assert(isNonEmptyString(value), `${ label } must be a non-empty string`);
    assert(value.length <= maxLength, `${ label } must be at most ${ maxLength } characters`);
    return value;
}

function normalizeOptionalText(value, maxLength, label) {
    if (value === undefined || value === null) {
        return null;
    }
    return normalizeRequiredText(value, maxLength, label);
}
