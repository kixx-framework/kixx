import { toFriendlyString } from '../../assertions/mod.js';


export default function truncate(context, options, str, length, ellipsis) {
    if (!str) {
        return '';
    }

    if (typeof str === 'string') {
        if (str.length <= length) {
            return str;
        }

        if (typeof ellipsis === 'undefined') {
            ellipsis = '&hellip;';
        }

        if (ellipsis) {
            return str.slice(0, length) + ellipsis;
        }

        return str.slice(0, length);
    }

    return toFriendlyString(str);
}
