import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import { CONSOLE_LINE_WIDTH, wrapText, wrapWords } from '../../lib/text-wrap.js';


describe('text-wrap', ({ describe }) => {

    describe('wrapWords()', ({ it }) => {
        it('breaks at whitespace without exceeding the width', () => {
            assertEqual('one two|three four', wrapWords('one two three four', 10).join('|'));
        });

        it('places a word longer than the width on its own line unsplit', () => {
            const uuid = '9e994fb2-72c6-45c6-be7c-1277fda6e9fb';

            assertEqual(`version|${ uuid }|exists`, wrapWords(`version ${ uuid } exists`, 20).join('|'));
        });

        it('keeps whitespace runs between words on the same line', () => {
            assertEqual('Worker:      name|next', wrapWords('Worker:      name next', 20).join('|'));
        });

        it('returns an empty array for text without words', () => {
            assertEqual(0, wrapWords('   ', 10).length);
        });
    });

    describe('wrapText()', ({ it }) => {
        it('defaults to an 80 character width', () => {
            const message =
                'Worker version 9e994fb2-72c6-45c6-be7c-1277fda6e9fb has no recorded value for declared ' +
                'secrets: ADMIN_BOOTSTRAP_TOKEN, CSRF_TOKEN_SIGNING_SECRET, ' +
                'DOCUMENT_STORE_CURSOR_SIGNING_SECRET. Set every declared secret before creating a Worker version.';

            const lines = wrapText(message).split('\n');

            assertEqual(80, CONSOLE_LINE_WIDTH);
            assert(lines.length > 1, 'expected the message to wrap');
            assert(lines.every((line) => line.length <= CONSOLE_LINE_WIDTH), 'expected no line over 80');
            assertEqual(message, lines.join(' '));
        });

        it('returns lines within the width unchanged, including trailing whitespace', () => {
            assertEqual('  a    b  ', wrapText('  a    b  ', 10));
        });

        it('preserves existing line breaks and blank lines', () => {
            assertEqual('one two\n\nthree four\nfive\n', wrapText('one two\n\nthree four five\n', 10));
        });

        it('indents continuation lines like the wrapped line', () => {
            assertEqual('    one two\n    three', wrapText('    one two three', 11));
        });

        it('aligns continuation lines after a list marker', () => {
            assertEqual('  - one two\n    three', wrapText('  - one two three', 11));
            assertEqual('1. one two\n   three', wrapText('1. one two three', 10));
        });

        it('returns a line unchanged when its indent consumes the width', () => {
            const line = `${ ' '.repeat(10) }one two`;

            assertEqual(line, wrapText(line, 10));
        });

        it('returns a whitespace-only line unchanged', () => {
            const line = ' '.repeat(12);

            assertEqual(line, wrapText(line, 10));
        });
    });
});
