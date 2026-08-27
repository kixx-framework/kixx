import { FastHTMLParser } from 'fast-html-dom-parser';
import { assert, assertNonEmptyString } from 'kixx-assert';


/**
 * Extracts the non-empty CSRF token emitted by a rendered HTML form.
 * @param {string} html - Rendered HTML containing a csrf_token field.
 * @returns {string} CSRF token value.
 */
export function assertHtmlCsrfToken(html) {
    const document = new FastHTMLParser(html);
    const [ field ] = document.getElementsByName('csrf_token');
    assert(field);
    const token = field.getAttribute('value');
    assertNonEmptyString(token);
    return token;
}
