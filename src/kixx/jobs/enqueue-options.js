import { assert, assertNonEmptyString, isUndefined } from '../assertions/mod.js';


/**
 * Validates an `enqueue()` call against the registry and resolves its timing.
 * Shared by every adapter so they reject the same inputs the same way.
 * @param {Map<string, import('./job-registry.js').ResolvedJobEntry>} registry - Output of `validateJobRegistry()`.
 * @param {string} name - Registered job name.
 * @param {import('./job-queue-interface.js').JobEnqueueOptions} [options]
 * @param {Date} now - The enqueue time.
 * @returns {{entry: import('./job-registry.js').ResolvedJobEntry, runAt: Date, key: (string|undefined)}}
 * @throws {AssertionError} When the name is unregistered or the options are invalid.
 */
export function resolveEnqueue(registry, name, options, now) {
    assertNonEmptyString(name, 'JobQueue#enqueue() name');

    const entry = registry.get(name);
    assert(entry, `JobQueue#enqueue() "${ name }" is not a registered job`);

    const { runAt, delaySeconds, key } = options ?? {};

    assert(
        isUndefined(runAt) || isUndefined(delaySeconds),
        'JobQueue#enqueue() options.runAt and options.delaySeconds are mutually exclusive',
    );

    let runAtDate = now;

    if (!isUndefined(runAt)) {
        runAtDate = new Date(runAt);
        assert(!Number.isNaN(runAtDate.getTime()), 'JobQueue#enqueue() options.runAt must be a valid date');
    } else if (!isUndefined(delaySeconds)) {
        assert(
            Number.isFinite(delaySeconds) && delaySeconds >= 0,
            'JobQueue#enqueue() options.delaySeconds must be a non-negative number',
        );
        runAtDate = new Date(now.getTime() + (delaySeconds * 1000));
    }

    return { entry, runAt: runAtDate, key };
}
