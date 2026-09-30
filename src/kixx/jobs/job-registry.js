import { parseCron } from './cron.js';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isPlainObject,
} from '../assertions/mod.js';


export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_TIMEOUT_SECONDS = 60;

const JOB_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY_FIELDS = [ 'name', 'description', 'handler', 'maxAttempts', 'timeoutSeconds', 'schedule' ];


/**
 * @typedef {Object} JobRegistryEntry
 * @property {string} name - Kebab-case job name; must equal the registry key.
 * @property {string} description - What the job does, for operators.
 * @property {import('./job-queue-interface.js').JobHandler} handler
 * @property {number} [maxAttempts=5] - Positive integer.
 * @property {number} [timeoutSeconds=60] - Positive integer; the handler's abort signal fires after this.
 * @property {{cron: string}} [schedule] - Recurring schedule as a UTC 5-field cron expression.
 */

/**
 * @typedef {Object} ResolvedJobEntry
 * @property {string} name
 * @property {string} description
 * @property {import('./job-queue-interface.js').JobHandler} handler
 * @property {number} maxAttempts
 * @property {number} timeoutSeconds
 * @property {{cron: string, parsed: import('./cron.js').ParsedCron}|null} schedule - Always UTC.
 */

/**
 * Validates a job registry and resolves per-entry defaults. Called once at
 * boot, so every failure is an assertion: a bad registry is a programmer error.
 *
 * `concurrency` entries and `schedule.timezone` are rejected rather than
 * silently ignored; per-name concurrency and local-time scheduling are not
 * supported.
 * @param {Map<string, JobRegistryEntry>} registry - Registry keyed by job name. May be empty.
 * @returns {Map<string, ResolvedJobEntry>} New map of frozen, fully resolved entries in registry order.
 * @throws {AssertionError} When the registry, any entry, or any cron expression is invalid.
 */
export function validateJobRegistry(registry) {
    assert(registry instanceof Map, 'validateJobRegistry() registry must be a Map');

    const resolved = new Map();

    for (const [ key, entry ] of registry) {
        assertNonEmptyString(key, 'validateJobRegistry() registry key');
        assert(
            isPlainObject(entry),
            `validateJobRegistry() entry for "${ key }" must be a plain object`,
        );

        assert(
            !Object.hasOwn(entry, 'concurrency'),
            `validateJobRegistry() entry "${ key }" sets concurrency, which is not supported; the runner owns concurrency`,
        );

        for (const field of Object.keys(entry)) {
            assert(
                ENTRY_FIELDS.includes(field),
                `validateJobRegistry() entry "${ key }" has unknown field "${ field }"`,
            );
        }

        assert(
            key === entry.name,
            `validateJobRegistry() key "${ key }" must equal entry.name "${ entry.name }"`,
        );
        assert(
            JOB_NAME_PATTERN.test(entry.name),
            `validateJobRegistry() entry.name "${ entry.name }" must be lowercase kebab-case`,
        );
        assertNonEmptyString(entry.description, `validateJobRegistry() entry.description for "${ key }"`);
        assertFunction(entry.handler, `validateJobRegistry() entry.handler for "${ key }"`);

        resolved.set(key, Object.freeze({
            name: entry.name,
            description: entry.description,
            handler: entry.handler,
            maxAttempts: resolvePositiveInteger(entry.maxAttempts, DEFAULT_MAX_ATTEMPTS, `entry.maxAttempts for "${ key }"`),
            timeoutSeconds: resolvePositiveInteger(entry.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, `entry.timeoutSeconds for "${ key }"`),
            schedule: resolveSchedule(entry.schedule, key),
        }));
    }

    return resolved;
}

function resolvePositiveInteger(value, defaultValue, label) {
    if (value === undefined) {
        return defaultValue;
    }

    assert(
        Number.isInteger(value) && value > 0,
        `validateJobRegistry() ${ label } must be a positive integer`,
    );

    return value;
}

function resolveSchedule(schedule, key) {
    if (schedule === undefined) {
        return null;
    }

    assert(
        isPlainObject(schedule),
        `validateJobRegistry() entry.schedule for "${ key }" must be a plain object`,
    );
    assert(
        !Object.hasOwn(schedule, 'timezone'),
        `validateJobRegistry() entry.schedule for "${ key }" sets timezone, which is not supported; cron is UTC only`,
    );

    for (const field of Object.keys(schedule)) {
        assert(
            field === 'cron',
            `validateJobRegistry() entry.schedule for "${ key }" has unknown field "${ field }"`,
        );
    }

    assertNonEmptyString(schedule.cron, `validateJobRegistry() entry.schedule.cron for "${ key }"`);

    let parsed;

    try {
        parsed = parseCron(schedule.cron);
    } catch (cause) {
        // A bad cron expression in the registry is a bug in the code that
        // declared it, so it surfaces as an assertion at boot.
        assert(false, `validateJobRegistry() entry.schedule.cron for "${ key }" is invalid: ${ cause.message }`);
    }

    return Object.freeze({ cron: schedule.cron, parsed });
}
