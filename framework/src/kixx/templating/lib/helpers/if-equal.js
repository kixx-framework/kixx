/* eslint-disable no-invalid-this */

export default function ifequal_helper(_context, _options, x, y) {
    if (x == y) { // eslint-disable-line eqeqeq
        return this.renderPrimary();
    }
    return this.renderInverse();
}
