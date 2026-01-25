/* eslint-disable no-invalid-this */

export default function with_helper(context, options, val) {
    // Render the else block if the value is an empty Array.
    if (Array.isArray(val) && val.length === 0) {
        return this.renderInverse(context);
    }

    const objectTag = Object.prototype.toString.call(val);

    // Render the else block if the value is an empty Map or Set.
    if ((objectTag === '[object Map]' || objectTag === '[object Set]') && val.size === 0) {
        return this.renderInverse(context);
    }

    // Render the else block if the value is falsy.
    if (!val) {
        return this.renderInverse(context);
    }

    // If the given value is a plain object, then we extend the context with it. Otherwise
    // we just use the value and leave the previous context behind.
    const newContext = isPlainObject(val) ? Object.assign({}, context, val) : val;
    return this.renderPrimary(newContext);
}

/**
 * Determines if the given value is a plain object.
 * A plain object is defined as an object that either has no prototype or has a constructor named "Object".
 * @param {*} value - The value to check.
 * @returns {boolean} True if the value is a plain object, false otherwise.
 */
function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (!Object.getPrototypeOf(value)) {
        return true;
    }
    return value.constructor && value.constructor.name === 'Object';
}
