
/**
 * Deeply merges one or more source objects into a target object.
 *
 * - If both the target and source property are Arrays, they are concatenated.
 * - If either the target or source property is an Array, the source value overwrites the target.
 * - If both the target and source property are plain objects, they are merged recursively.
 * - Otherwise, the source value overwrites the target.
 *
 * @param {Object} finalTarget - The target object to merge into (mutated in place).
 * @param {...Object} objects - One or more source objects to merge from.
 * @returns {Object} The mutated target object after merging.
 */
export default function deepMerge(finalTarget, ...objects) {
    /**
     * Recursively merges properties from the source object into the target object.
     *
     * @param {Object} target - The object to merge into.
     * @param {Object} source - The object to merge from.
     */
    function mergeInto(target, source) {
        for (const key of Object.keys(source)) {
            const src = source[key];
            const dest = target[key];

            if (Array.isArray(dest) && Array.isArray(src)) {
                // Concatenate arrays if both target and source are arrays.
                target[key] = dest.concat(src);
            } else if (Array.isArray(dest) || Array.isArray(src)) {
                // Overwrite if either is an array.
                target[key] = src;
            } else if (dest && typeof dest === 'object' && src && typeof src === 'object') {
                // Recursively merge if both are non-null objects.
                mergeInto(dest, src);
            } else {
                // Overwrite with source value in all other cases.
                target[key] = src;
            }
        }
    }

    for (const src of objects) {
        mergeInto(finalTarget, src);
    }

    return finalTarget;
}
