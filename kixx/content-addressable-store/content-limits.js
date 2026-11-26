/**
 * The content store's size limits (PERF-1). The Publishing API enforces
 * them on what it receives, and the content compiler refuses to build a
 * Release that breaks one, so both read them from here.
 * @module content-addressable-store/content-limits
 */

// The largest content object, in bytes.
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

// The most content objects one Release manifest may name.
export const MAX_MANIFEST_ENTRIES = 10_000;
