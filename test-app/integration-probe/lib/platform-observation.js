// What a platform check reports. A check runs one call against a real
// binding and says what happened, as data. It never asserts.

const MAX_MESSAGE_LENGTH = 500;

/**
 * @typedef {Object} PlatformObservation
 * @property {'resolved'|'rejected'} outcome
 * @property {*} [value] - What the call resolved, when it is small and JSON-safe
 * @property {string} [errorName] - The name of what it threw
 * @property {string} [message] - Its message, cut to 500 characters
 */

/**
 * Runs a call and reports what happened. A throw is an observation, not a
 * failure.
 *
 * @param {function(): *} call - May be async
 * @returns {Promise<PlatformObservation>}
 */
export async function observe(call) {
    try {
        const value = await call();

        return { outcome: 'resolved', value: value ?? null };
    } catch (error) {
        return {
            outcome: 'rejected',
            errorName: String(error?.name ?? 'Error'),
            message: String(error?.message ?? error).slice(0, MAX_MESSAGE_LENGTH),
        };
    }
}
