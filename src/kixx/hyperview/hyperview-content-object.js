const decoder = new TextDecoder();

/**
 * Attributes of one Hyperview content resource resolved from a snapshot,
 * without its bytes. Compiled-template caches key on `etag` and compare it
 * against the matching stat's etag, so a caller that discards this value
 * turns those caches into permanent misses.
 */
export class HyperviewContentStat {

    /**
     * @param {Object} spec - Resolved index-entry attributes
     * @param {('tree'|'blob')} spec.kind - 'tree' for a directory, 'blob' for a file
     * @param {string} spec.hash - Content digest of the blob's bytes
     * @param {number|null} spec.size - Byte size of a blob, or null for a tree
     * @param {Object|null} spec.metadata - Caller-supplied metadata for a blob, or null
     * @param {string} spec.etag - Digest of a blob's content hash and metadata, or the content hash for a tree
     */
    constructor(spec) {
        this.kind = spec.kind;
        this.hash = spec.hash;
        this.size = spec.size;
        this.metadata = spec.metadata;
        this.etag = spec.etag;
    }
}

/**
 * One Hyperview content resource's bytes plus its resolved attributes.
 */
export class HyperviewContentObject extends HyperviewContentStat {

    #bytes;

    /**
     * @param {Uint8Array} bytes - The resource's raw bytes
     * @param {Object} spec - Resolved index-entry attributes; see {@link HyperviewContentStat}
     */
    constructor(bytes, spec) {
        super(spec);
        this.#bytes = bytes;
    }

    /**
     * Decodes the resource's bytes as UTF-8 text.
     * @returns {string} Decoded text
     */
    text() {
        return decoder.decode(this.#bytes);
    }

    /**
     * Decodes the resource's bytes as UTF-8 text and parses it as JSON.
     * @returns {*} Parsed JSON value
     * @throws {SyntaxError} When the decoded text is not valid JSON
     */
    json() {
        return JSON.parse(this.text());
    }
}
