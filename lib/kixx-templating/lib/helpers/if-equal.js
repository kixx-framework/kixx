/* eslint-disable no-invalid-this */

export default function ifequal_helper(context, options, x, y) {
    if (x == y) { // eslint-disable-line eqeqeq
        return this.renderPrimary(context);
    }
    return this.renderInverse(context);
}
