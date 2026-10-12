import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';

import truncate from '../../../../../src/kixx/hyperview/helpers/truncate.js';


// The helper signature is (context, options, ...positionals); neither of the
// first two is used, so every call here passes null for both.
function render(...args) {
    return truncate(null, null, ...args);
}


describe('truncate helper', ({ it }) => {

    it('returns a string shorter than the limit unchanged', () => {
        assertEqual('Paid in Full', render('Paid in Full', 20));
    });

    it('returns a string exactly at the limit unchanged', () => {
        assertEqual('Paid in Full', render('Paid in Full', 12));
    });

    it('shortens a longer string and appends the default ellipsis', () => {
        assertEqual('Follow the&hellip;', render('Follow the Leader', 10));
    });

    it('appends a supplied suffix instead of the default', () => {
        assertEqual('Follow the...', render('Follow the Leader', 10, '...'));
    });

    it('appends nothing when the suffix is an empty string', () => {
        assertEqual('Follow the', render('Follow the Leader', 10, ''));
    });

    it('returns the string unchanged when no length is given', () => {
        // Without the guard this compares against undefined, fails, and then
        // slices the whole string — appending an ellipsis to text which was
        // never shortened.
        assertEqual('Follow the Leader', render('Follow the Leader'));
    });

    it('returns the string unchanged when the length is not a number', () => {
        assertEqual('Follow the Leader', render('Follow the Leader', 'ten'));
    });

    it('returns an empty string for an empty string', () => {
        assertEqual('', render('', 10));
    });

    it('returns an empty string for null', () => {
        assertEqual('', render(null, 10));
    });

    it('returns an empty string for undefined', () => {
        assertEqual('', render(undefined, 10));
    });

    it('renders a diagnostic string for a non-string value', () => {
        assertMatches('Object', render({ summary: 'text' }, 10));
    });
});
