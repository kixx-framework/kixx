/**
 * HyperviewStaticFileServerStore port — the abstraction for loading static
 * files (CSS, JS, images, fonts, etc.) to be served directly by the
 * Hyperview static file handler.
 *
 * Implement this interface to support different static file sources: local
 * filesystem directories (node-local-store/StaticFileServerStore), CDN
 * origins, object storage buckets, etc.
 *
 * ## Invariants
 * - getFile() MUST resolve with a file descriptor Object when the file exists,
 *   or null when it does not; never reject for a missing file
 * - The resolved Object MUST include enough information for the caller to
 *   serve the file: at minimum a readable stream or buffer and a content type
 * - getFile() MUST be safe to call concurrently for different pathnames
 *
 * @module ports/hyperview-static-file-server-store
 */

/**
 * @typedef {Object} HyperviewStaticFileServerStore
 * @property {function(string): Promise<Object|null>} getFile
 *   Loads a static file by URL pathname.
 *   MUST resolve with a file descriptor Object or null; never reject for a
 *   missing file (use null to signal "not found").
 */
