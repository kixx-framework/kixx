/**
 * Recursively freezes arrays and plain objects, mutating the input graph.
 *
 * Non-plain objects such as Date instances, class instances, and functions are
 * left unchanged. The same input reference is returned so callers can use this
 * as the final step when constructing immutable shared data.
 *
 * @template Value
 * @param {Value} value - Value to freeze
 * @returns {Value} The same value reference after freezing
 */
export default function deepFreeze(value) {
    return freezeValue(value, new WeakSet());
}

function freezeValue(value, seen) {
    if (!isFreezableValue(value) || seen.has(value)) {
        return value;
    }

    seen.add(value);

    for (const childValue of Object.values(value)) {
        freezeValue(childValue, seen);
    }

    return Object.freeze(value);
}

function isFreezableValue(value) {
    return Array.isArray(value) || isPlainObject(value);
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
