import { parseHTML } from 'parse-html-dom';
import { assert, assertNonEmptyString } from 'kixx-assert';


/**
 * Extracts the non-empty CSRF token emitted by a rendered HTML form.
 * @param {string} html - Rendered HTML containing a csrf_token field.
 * @returns {string} CSRF token value.
 */
export function assertHtmlCsrfToken(html) {
    const document = parseHTML(html);
    const [ field ] = document.querySelectorAll('[name="csrf_token"]');
    assert(field);
    const token = field.getAttribute('value');
    assertNonEmptyString(token);
    return token;
}
