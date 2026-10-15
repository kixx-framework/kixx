/**
 * Wraps terminal text to a fixed line width. Breaks only at whitespace and
 * never splits a word, so paths, hashes, UUIDs, and tokens stay copyable even
 * when they are longer than a line.
 * @module text-wrap
 */

/**
 * Line width for everything the CLI writes to the console.
 * @type {number}
 */
export const CONSOLE_LINE_WIDTH = 80;

// Leading whitespace plus an optional list marker. Continuation lines align
// under the text after the marker rather than under the marker itself.
const LINE_LEAD_PATTERN = /^\s*(?:[-*] |\d+\. )?/;

/**
 * Wraps each line of text independently. Existing line breaks, blank lines,
 * and lines already within the width are preserved exactly. Continuation
 * lines repeat the wrapped line's leading indentation.
 * @param {string} text - Text which may contain line breaks
 * @param {number} [width=CONSOLE_LINE_WIDTH] - Maximum line length
 * @returns {string} Wrapped text
 */
export function wrapText(text, width = CONSOLE_LINE_WIDTH) {
    return text
        .split('\n')
        .map((line) => wrapLine(line, width))
        .join('\n');
}

/**
 * Breaks one line of text into lines no longer than the width. A word longer
 * than the width is placed on its own line, unsplit. Whitespace between words
 * which stay on the same line is kept, so aligned columns survive.
 * @param {string} text - Single line of text without leading indentation
 * @param {number} width - Maximum line length
 * @returns {string[]} Wrapped lines, empty when the text has no words
 */
export function wrapWords(text, width) {
    const lines = [];
    let line = '';

    for (const [ , gap, word ] of text.matchAll(/(\s*)(\S+)/g)) {
        if (!line) {
            line = word;
        } else if (line.length + gap.length + word.length <= width) {
            line += `${ gap }${ word }`;
        } else {
            lines.push(line);
            line = word;
        }
    }

    if (line) {
        lines.push(line);
    }

    return lines;
}

function wrapLine(line, width) {
    if (line.length <= width) {
        return line;
    }

    const [ lead ] = line.match(LINE_LEAD_PATTERN);
    const availableWidth = width - lead.length;
    const wrappedLines = wrapWords(line.slice(lead.length), availableWidth);

    // An indent consuming the whole width, or a whitespace-only line, has no
    // useful wrapping; returning it unchanged beats emitting a broken layout.
    if (availableWidth < 1 || wrappedLines.length === 0) {
        return line;
    }

    // Tabs in the indent are kept so continuation lines align however the
    // terminal renders them; only the list marker becomes spaces.
    const continuationLead = lead.replace(/\S/g, ' ');
    const [ firstLine, ...continuationLines ] = wrappedLines;

    return [
        `${ lead }${ firstLine }`,
        ...continuationLines.map((continuationLine) => `${ continuationLead }${ continuationLine }`),
    ].join('\n');
}
