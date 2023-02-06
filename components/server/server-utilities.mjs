/**
 * Sent when the incoming HTTP Host header is invalid.
 */
export function sendInvalidHostResponse(req, res) {
	const body = 'Bad Request: Invalid host request header\n';

	res.writeHead(400, 'Bad Request', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

/**
 * Sent when the incoming URL string is invalid according to HTTP rules.
 */
export function sendInvalidUrlResponse(req, res) {
	const body = 'Bad Request: Invalid URL\n';

	res.writeHead(400, 'Bad Request', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

/**
 * Sent when the host indicated by the incoming HTTP Host header is not available on this server.
 */
export function sendNotFoundHostResponse(req, res) {
	const body = 'Not Found: Host not found\n';

	res.writeHead(404, 'Not Found', {
		'content-type': 'text/plain; charset=UTF-8',
		'content-length': Buffer.byteLength(body),
	});

	res.end(body);
}

export function send301Redirect(req, res, location) {
	res.writeHead(301, 'Moved Permanently', { location });
	res.end();
}

export function sendServerError(req, res) {
	if (res.writableEnded) {
		// Nothing we can do if .end() has already been called.
		return;
	}

	if (res.headersSent) {
		// Attempt to complete the response if headers have already been sent.
		res.end();
	} else {
		// Remove any headers which may have already been set.
		res.getHeaderNames().forEach((headerName) => {
			res.removeHeader(headerName);
		});

		const body = 'Server Error: Unexpected server error\n';

		res.writeHead(500, 'Server Error', {
			'content-type': 'text/plain; charset=UTF-8',
			'content-length': Buffer.byteLength(body),
		});

		res.end(body);
	}
}
