import { marked } from '../../vendor/marked/mod.js';
import { toFriendlyString } from '../../assertions/mod.js';


export default function markup(_context, _options, markdown) {
    if (markdown === '') {
        return '';
    }

    if (typeof markdown === 'string') {
        return marked.parse(markdown);
    }

    return toFriendlyString(markdown);
}
