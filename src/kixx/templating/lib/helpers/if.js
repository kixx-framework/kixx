/* eslint-disable no-invalid-this */

export default function if_helper(_context, _options, val) {
    if (Array.isArray(val)) {
        if (val.length > 0) {
            return this.renderPrimary();
        }
        return this.renderInverse();
    }

    const objectTag = Object.prototype.toString.call(val);

    if (objectTag === '[object Map]' || objectTag === '[object Set]') {
        if (val.size > 0) {
            return this.renderPrimary();
        }
        return this.renderInverse();
    }

    if (val) {
        return this.renderPrimary();
    }
    return this.renderInverse();
}
