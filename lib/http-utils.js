
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
        mimeType: 'text/css',
        pattern: /^text\/css/,
        fileExtensions: [ 'css' ],
    },
];

const SINGLULAR_HEADERS = [
    'age',
    'authorization',
    'content-length',
    'content-type',
    'etag',
    'expires',
    'from',
    'host',
    'if-modified-since',
    'if-unmodified-since',
    'last-modified',
    'location',
    'max-forwards',
    'proxy-authorization',
    'referer',
    'retry-after',
    'server',
    'user-agent',
];

export function headersToObject(headers) {
    if (headers instanceof Headers) {
        const obj = {};

        for (const [ key, val ] of headers.entries()) {
            obj[key] = val;
        }

        return obj;
    }

    return headers;
}

export function objectToHeaders(obj) {
    const headers = new Headers();

    for (const key of Object.keys(obj)) {
        let values;

        if (SINGLULAR_HEADERS.includes(key)) {
            headers.set(key, obj[key]);
        } else if (key === 'cookie') {
            values = obj[key].split(';').map((s) => s.trim());
        } else {
            values = obj[key].split(',').map((s) => s.trim());
        }

        if (values) {
            for (const val of values) {
                headers.append(key, val);
            }
        }
    }

    return headers;
}

const FileExtensionToContentType = new Map();

MimeTypes.forEach(({ mimeType, fileExtensions }) => {
    fileExtensions.forEach((extension) => {
        FileExtensionToContentType.set(extension, mimeType);
    });
});

export function getContentTypeForFileExtension(extname) {
    const key = extname.toLowerCase().replace(/^[.]+/, '');
    return FileExtensionToContentType.get(key);
}

export function getFileExtensionForContentType(contentType) {
    for (let i = 0; i < MimeTypes.length; i = i + 1) {
        const { pattern, fileExtensions } = MimeTypes[i];
        if (pattern.test(contentType)) {
            return `.${ fileExtensions[0] }`;
        }
    }

    return '';
}
