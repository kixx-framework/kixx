/**
 * Maps file extensions to HTTP `Content-Type` header values for the static file
 * server. The Node.js adapter uses this to label file bodies it reads from disk;
 * platforms that derive the type themselves (Cloudflare Static Assets) do not need
 * it.
 * @module mime-types
 */

// Text-based types carry an explicit `; charset=utf-8` so the header is correct
// for the bytes we serve. Binary types are emitted without a charset.
const CONTENT_TYPES_BY_EXTENSION = Object.freeze({
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    map: 'application/json; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    svg: 'image/svg+xml; charset=utf-8',
    webmanifest: 'application/manifest+json; charset=utf-8',

    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',

    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',

    pdf: 'application/pdf',
    wasm: 'application/wasm',
    zip: 'application/zip',

    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
});

// The safe default for an unknown or extensionless file: treat the bytes as
// opaque so a browser downloads rather than guesses (and never executes) them.
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Resolves the `Content-Type` header value for a file pathname by its extension.
 * @param {string} pathname - File pathname; only the final path segment's extension is inspected.
 * @returns {string} The matching content type, or `application/octet-stream` when the extension is unknown or absent.
 */
export function getContentType(pathname) {
    // Inspect only the final segment so a dot in a parent directory name cannot
    // be mistaken for the file extension.
    const filename = pathname.slice(pathname.lastIndexOf('/') + 1);
    const dotIndex = filename.lastIndexOf('.');

    // No dot, or a leading dot with nothing after it, means no usable extension.
    if (dotIndex <= 0 || dotIndex === filename.length - 1) {
        return DEFAULT_CONTENT_TYPE;
    }

    const extension = filename.slice(dotIndex + 1).toLowerCase();
    return CONTENT_TYPES_BY_EXTENSION[extension] ?? DEFAULT_CONTENT_TYPE;
}
