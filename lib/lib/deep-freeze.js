/**
 * Recursively applies Object.freeze to an object and all of its nested properties.
 *
 * - All own properties (including non-enumerable) are traversed.
 * - If a property value is a non-null object and not already frozen, it is recursively deep frozen.
 * - The original object is returned after being deeply frozen.
 *
 * @param {Object} obj - The object to deep freeze.
 * @returns {Object} The deeply frozen object.
 */
export default function deepFreeze(obj) {
    // Retrieve the property names defined on the object
    const propNames = Object.getOwnPropertyNames(obj);

    // Freeze properties before freezing self
    for (const name of propNames) {
        const value = obj[name];

        // If the value is an object and not already frozen, recursively freeze it
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }

    // Freeze the object itself
    return Object.freeze(obj);
}
