import { marked } from '../../vendor/mod.js';
import { toFriendlyString } from '../../assertions/mod.js';


export default function markup(context, options, markdown) {
    if (markdown === '') {
        return '';
    }

    if (typeof markdown === 'string') {
        return marked.parse(markdown);
    }

    return toFriendlyString(markdown);
}
