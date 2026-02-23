/* eslint-disable no-invalid-this */

export default function unless_helper(context, options, val) {
    if (!val) {
        return this.renderPrimary(context);
    }
    if (Array.isArray(val)) {
        if (val.length === 0) {
            return this.renderPrimary(context);
        }
        return this.renderInverse(context);
    }

    const objectTag = Object.prototype.toString.call(val);

    if (objectTag === '[object Map]' || objectTag === '[object Set]') {
        if (val.size === 0) {
            return this.renderPrimary(context);
        }
        return this.renderInverse(context);
    }

    if (typeof val === 'object') {
        if (Object.keys(val).length === 0) {
            return this.renderPrimary(context);
        }
        return this.renderInverse(context);
    }

    return this.renderInverse(context);
}
