/**
 * Deep freezes an object and all its nested properties
 * @param {Object} obj - The object to deep freeze
 * @returns {Object} - The frozen object
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
