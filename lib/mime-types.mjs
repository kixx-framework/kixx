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

