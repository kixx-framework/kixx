/* eslint-disable no-invalid-this */

export default function with_helper(_context, _options, val) {
    // Render the else block if the value is an empty Array.
    if (Array.isArray(val) && val.length === 0) {
        return this.renderInverse();
    }

    const objectTag = Object.prototype.toString.call(val);

    // Render the else block if the value is an empty Map or Set.
    if ((objectTag === '[object Map]' || objectTag === '[object Set]') && val.size === 0) {
        return this.renderInverse();
    }

    // Render the else block if the value is falsy.
    if (!val) {
        return this.renderInverse();
    }

    return this.renderPrimary(val);
}
