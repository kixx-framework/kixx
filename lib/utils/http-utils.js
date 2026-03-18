
export const HTTP_METHODS = 'GET HEAD POST PUT PATCH DELETE'.split(' ');

const MimeTypes = [
    {
        mimeType: 'application/json',
        pattern: /^application\/json/,
        fileExtensions: [ 'json', 'webmanifest' ],
    },
    {
        mimeType: 'application/xml',
        pattern: /^application\/xml/,
        fileExtensions: [ 'xml' ],
    },
    {
        mimeType: 'text/javascript',
        pattern: /^text\/javascript/,
        fileExtensions: [ 'js' ],
    },
    {
        mimeType: 'image/jpeg',
        pattern: /^image\/jpeg/,
        fileExtensions: [ 'jpg', 'jpeg' ],
    },
    {
        mimeType: 'image/png',
        pattern: /^image\/png/,
        fileExtensions: [ 'png' ],
    },
    {
        mimeType: 'image/svg+xml',
        pattern: /^image\/svg\+xml/,
        fileExtensions: [ 'svg' ],
    },
    {
        mimeType: 'image/x-icon',
        pattern: /^image\/x-icon/,
        fileExtensions: [ 'ico' ],
    },
    {
        mimeType: 'text/plain',
        pattern: /^text\/plain/,
        fileExtensions: [ 'txt', 'text' ],
    },
    {
        mimeType: 'text/html',
        pattern: /^text\/html/,
        fileExtensions: [ 'html', 'htm' ],
    },
    {
        mimeType: 'text/css',
        pattern: /^text\/css/,
        fileExtensions: [ 'css' ],
    },
];

/**
 * Map of file extensions to their corresponding MIME types.
 * @type {Map<string, string>}
 */
const FileExtensionToContentType = new Map();

MimeTypes.forEach(({ mimeType, fileExtensions }) => {
    fileExtensions.forEach((extension) => {
        FileExtensionToContentType.set(extension, mimeType);
    });
});

/**
 * Gets the MIME type for a given file extension.
 *
 * @param {string} extname - The file extension (with or without leading dot).
 * @returns {string|undefined} The corresponding MIME type, or undefined if not found.
 */
export function getContentTypeForFileExtension(extname) {
    const key = extname.toLowerCase().replace(/^[.]+/, '');
    return FileExtensionToContentType.get(key);
}

/**
 * Gets the MIME type for a filepath or URL pathname based on its extension.
 *
 * This helper intentionally avoids platform-specific path modules so it can be
 * used from framework core code that should remain portable across runtimes.
 *
 * @param {string} filepath - Filepath or URL pathname to inspect
 * @returns {string|undefined} The corresponding MIME type, or undefined if not found
 */
export function getContentTypeForFilepath(filepath) {
    const match = /(?:^|[/])[^/]*?(\.[a-z0-9]+)$/i.exec(filepath);

    if (!match) {
        return undefined;
    }

    return getContentTypeForFileExtension(match[1]);
}

/**
 * Gets the file extension (with leading dot) for a given content type.
 *
 * @param {string} contentType - The MIME type to look up.
 * @returns {string} The file extension (with leading dot), or an empty string if not found.
 */
export function getFileExtensionForContentType(contentType) {
    contentType = contentType.toLowerCase();

    for (let i = 0; i < MimeTypes.length; i = i + 1) {
        const { pattern, fileExtensions } = MimeTypes[i];
        if (pattern.test(contentType)) {
            return `.${ fileExtensions[0] }`;
        }
    }

    return '';
}
