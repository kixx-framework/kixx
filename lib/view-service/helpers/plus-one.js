import { escapeHTMLChars } from '../../template-engine/mod.js';

export default function plusOne(context, options, num) {
    return escapeHTMLChars((num + 1).toString());
}
