export default function unescape_helper(_context, _options, val) {
    if (typeof val === 'undefined' || val === null) {
        return '';
    }
    if (!val || typeof val !== 'string') {
        // eslint-disable-next-line no-implicit-coercion
        return val + '';
    }
    return val;
}
