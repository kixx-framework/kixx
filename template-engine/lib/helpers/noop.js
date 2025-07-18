export default function noop_helper(context, options, val) {
    if (typeof val === 'undefined' || val === null) {
        return '';
    } else if (!val || typeof val !== 'string') {
        // eslint-disable-next-line no-implicit-coercion
        return val + '';
    }
    return val;
}
