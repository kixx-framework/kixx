/**
 * Deeply merges plain source objects into a plain target object, mutating the
 * target in place.
 *
 * Sources are applied in argument order. For each of a source's own enumerable
 * properties:
 * - Nested plain objects are merged recursively into the matching target value,
 *   or into a fresh object when the existing target value is not a plain object.
 * - Arrays and all other values overwrite the existing target value.
 *
 * Arrays and plain objects taken from a source are deep-copied into the target,
 * so later mutation of the target cannot reach back into a source. All other
 * values (for example Date instances, class instances, and functions) are
 * shared by reference, not cloned.
 *
 * Keys named '__proto__' are skipped to guard against prototype pollution from
 * untrusted input such as parsed JSON.
 *
 * @param {Object} finalTarget - Plain target object, mutated in place and returned.
 * @param {...Object} objects - Plain source objects merged in argument order.
 * @returns {Object} The same finalTarget reference, after merging.
 * @throws {TypeError} When the target or any source is not a plain object.
 */
export default function deepMerge(finalTarget, ...objects) {
    if (!isPlainObject(finalTarget)) {
        throw new TypeError('deepMerge() target must be a plain object.');
    }

    for (const source of objects) {
        if (!isPlainObject(source)) {
            throw new TypeError('deepMerge() sources must be plain objects.');
        }
        mergeInto(finalTarget, source);
    }

    return finalTarget;
}

function mergeInto(target, source) {
    for (const key of Object.keys(source)) {
        // JSON payloads can carry this key; assigning it mutates the target prototype.
        if (key === '__proto__') {
            continue;
        }

        const sourceValue = source[key];

        if (isPlainObject(sourceValue)) {
            const targetValue = target[key];
            const nestedTarget = isPlainObject(targetValue) ? targetValue : {};

            target[key] = mergeInto(nestedTarget, sourceValue);
            continue;
        }

        target[key] = cloneValue(sourceValue);
    }

    return target;
}

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneValue(item));
    }

    if (isPlainObject(value)) {
        return mergeInto({}, value);
    }

    // Primitives and non-plain objects (Date, class instances, functions) are
    // shared by reference; deep-cloning them is out of scope for this merge.
    return value;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    // A null prototype (e.g. Object.create(null) dictionaries) also counts as
    // plain, alongside ordinary object literals.
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
