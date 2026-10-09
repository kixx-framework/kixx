/**
 * @module content-object
 *
 * The shapes {@link ContentSnapshot} reads resolve to: an index entry's stats
 * paired with the blob's bytes in one of four representations.
 *
 * The subclasses exist because the store records no type metadata — a caller
 * declares the representation it wants on every read, and the class it gets back
 * is what makes that declaration visible at the call site. Which one you receive
 * is fixed per snapshot method, not inferred from the content.
 */

/**
 * Index-entry stats for a blob, without its bytes. The base class for every
 * content object, and the shape a `stat*` read resolves on its own.
 */
export class ContentObject {

    /**
     * @param {import('./content-addressable-index.js').IndexEntry} stats - Decoded index entry for the blob
     */
    constructor(stats) {
        this.pathname = stats.pathname;
        this.hash = stats.hash;
        this.size = stats.size;
        this.metadata = stats.metadata;
    }
}

/**
 * A blob read as UTF-8 text and left unparsed. Used for page templates, whose
 * source is handed straight to the template compiler.
 * @extends ContentObject
 */
export class TextContentObject extends ContentObject {

    /**
     * @param {string} text - The blob's bytes decoded as UTF-8
     * @param {import('./content-addressable-index.js').IndexEntry} stats - Decoded index entry for the blob
     */
    constructor(text, stats) {
        super(stats);
        this.text = text;
    }
}

/**
 * A blob read as text and parsed as JSON on construction. Used for page
 * metadata and the partial, include, and email bundles, all of which are
 * written through `canonicalize()`.
 * @extends ContentObject
 */
export class JsonContentObject extends ContentObject {

    /**
     * @param {string} json - The blob's bytes decoded as UTF-8 JSON
     * @param {import('./content-addressable-index.js').IndexEntry} stats - Decoded index entry for the blob
     * @throws {SyntaxError} When the blob does not contain valid JSON
     */
    constructor(json, stats) {
        super(stats);
        this.json = JSON.parse(json);
    }
}

/**
 * A blob exposed as an unread stream, so its bytes can go to the response
 * without being buffered in memory. Only static assets are read this way.
 *
 * The stream is single-use and holds an underlying binding or file handle open.
 * A caller that does not consume it — answering a HEAD request, or returning a
 * 304 — MUST cancel it.
 * @extends ContentObject
 */
export class StreamContentObject extends ContentObject {

    /**
     * @param {ReadableStream} stream - Single-use stream over the blob's bytes
     * @param {import('./content-addressable-index.js').IndexEntry} stats - Decoded index entry for the blob
     */
    constructor(stream, stats) {
        super(stats);
        this.stream = stream;
    }
}
