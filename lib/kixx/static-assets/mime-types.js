/**
 * Maps static-asset file extensions to HTTP `Content-Type` header values.
 * @module mime-types
 */

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

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/**
 * Resolves a static asset's content type from its final pathname extension.
 * @param {string} pathname - Logical asset pathname
 * @returns {string} Matching type, or an opaque binary default
 */
export function getContentType(pathname) {
    const filename = pathname.slice(pathname.lastIndexOf('/') + 1);
    const dotIndex = filename.lastIndexOf('.');

    if (dotIndex <= 0 || dotIndex === filename.length - 1) {
        return DEFAULT_CONTENT_TYPE;
    }

    return CONTENT_TYPES_BY_EXTENSION[filename.slice(dotIndex + 1).toLowerCase()]
        ?? DEFAULT_CONTENT_TYPE;
}
