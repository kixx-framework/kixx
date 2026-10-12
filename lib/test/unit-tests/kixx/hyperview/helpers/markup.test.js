import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import markup from '../../../../../src/kixx/hyperview/helpers/markup.js';


// The helper signature is (context, options, ...positionals); neither of the
// first two is used, so every call here passes null for both.
function render(value) {
    return markup(null, null, value);
}


describe('markup helper', ({ it }) => {

    it('renders Markdown source as HTML', () => {
        assertMatches('<em>Leader</em>', render('Follow the *Leader*'));
    });

    it('renders a paragraph as a block element', () => {
        assertMatches('<p>', render('A paragraph.'));
    });

    it('returns an empty string for an empty string', () => {
        assertEqual('', render(''));
    });

    it('returns an empty string for null', () => {
        // An absent optional page field must render as an omission, not as the
        // literal text "null".
        assertEqual('', render(null));
    });

    it('returns an empty string for undefined', () => {
        assertEqual('', render(undefined));
    });

    it('returns an empty string when called with no value at all', () => {
        assertEqual('', markup(null, null));
    });

    it('renders a diagnostic string for a non-string value', () => {
        // A mistyped field should still render the page and show what it received.
        assertMatches('Object', render({ body: 'text' }));
    });
});
