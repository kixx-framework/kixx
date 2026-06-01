/**
 * Deeply merges plain source objects into a plain target object.
 *
 * Plain object properties are merged recursively. Arrays and other values from
 * later sources replace earlier values. Source arrays and plain objects are
 * copied into the target so subsequent merges do not mutate source objects.
 *
 * @param {Object} finalTarget - Plain target object to mutate in place.
 * @param {...Object} objects - Plain source objects merged in order.
 * @returns {Object} The mutated target object.
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

    return value;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
