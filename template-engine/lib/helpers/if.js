/* eslint-disable no-invalid-this */

export default function if_helper(context, options, val) {
    if (Array.isArray(val)) {
        if (val.length > 0) {
            return this.renderPrimary(context);
        }
        return this.renderInverse(context);
    }

    const objectTag = Object.prototype.toString.call(val);

    if (objectTag === '[object Map]' || objectTag === '[object Set]') {
        if (val.size > 0) {
            return this.renderPrimary(context);
        }
        return this.renderInverse(context);
    }

    if (val) {
        return this.renderPrimary();
    }
    return this.renderInverse(context);
}
