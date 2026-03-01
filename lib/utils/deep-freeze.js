
/**
 * Deeply freezes an object and all of its nested properties, making the entire
 * object graph immutable.
 *
 * - Arrays are frozen recursively.
 * - Plain objects are frozen recursively.
 * - Primitives and null values are left as-is.
 *
 * @param {Object|Array} obj - The object or array to freeze.
 * @returns {Object|Array} The frozen object (same reference as input).
 */
export default function deepFreeze(obj) {
    // Return non-object values as-is (primitives, null, undefined).
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    // Freeze arrays and objects recursively.
    for (const key of Object.keys(obj)) {
        const value = obj[key];

        // Recursively freeze nested objects and arrays.
        if (value !== null && typeof value === 'object') {
            deepFreeze(value);
        }
    }

    // Freeze the object itself.
    Object.freeze(obj);

    return obj;
}
