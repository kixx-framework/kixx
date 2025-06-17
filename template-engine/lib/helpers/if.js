/* eslint-disable no-invalid-this */

export default function if_helper(context, options, val) {
    if (val) {
        return this.renderPrimary();
    }
    return this.renderInverse(context);
}
