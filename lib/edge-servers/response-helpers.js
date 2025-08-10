import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';


const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_.-]/i;


export function sendInvalidHostResponse(req, res) {
    const body = 'Bad Request: Invalid host request header\n';
    sendErrorResponse(req, res, 404, body);
}

export function sendInvalidUrlResponse(req, res) {
    const body = 'Bad Request: Invalid URL\n';
    sendErrorResponse(req, res, 400, body);
}

export function sendNotFoundHostResponse(req, res) {
    const body = 'Host not found\n';
    sendErrorResponse(req, res, 404, body);
}

export function sendBadGateway(req, res) {
    sendErrorResponse(req, res, 502);
}

export function sendRequestTimeout(req, res) {
    sendErrorResponse(req, res, 408);
}

export function sendGatewayTimeout(req, res) {
    sendErrorResponse(req, res, 504);
}

export async function sendAcmeChallenge(req, res, logger, baseDirectory, url) {

    const { pathname } = url;

    // Two dots or two slashes are always invalid
    if (pathname.includes('..') || pathname.includes('//')) {
        sendErrorResponse(req, res, 400, `Invalid static file path: ${ pathname }`);
        return;
    }

    const parts = pathname.split('/');

    for (const part of parts) {
        // In addition to the pattern list, a single dot at the start of
        // a path part is invalid.
        if (DISALLOWED_STATIC_PATH_CHARACTERS.test(part)) {
            sendErrorResponse(req, res, 400, `Invalid static file path: ${ pathname }`);
            return;
        }
    }

    // The call to path.join() normalizes the directory strings, so we
    // don't need to remove slashes "/" from the baseDirectory.
    const filepath = path.join(baseDirectory, ...parts);

    let stat;
    try {
        stat = await fsp.stat(filepath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            sendErrorResponse(req, res, 404, 'File not found');
            return;
        }

        logger.error('acme challenge stat file failed', { filepath, error });
        sendErrorResponse(req, res, 404, 'File not accessible');
        return;
    }

    if (!stat.isFile()) {
        sendErrorResponse(req, res, 404, 'Resource is not a file');
        return;
    }

    const headers = {
        'content-length': stat.size,
        'content-type': 'application/octet-stream',
        'connection': 'close',
    };

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
        res.end();
    } else {
        fs.createReadStream(filepath).pipe(res);
    }
}

export function sendErrorResponse(req, res, statusCode, utf8Body = '') {
    const headers = { connection: 'close' };

    if (utf8Body) {
        headers['content-type'] = 'text/plain; charset=UTF-8';
        headers['content-length'] = Buffer.byteLength(utf8Body).toString();
    }

    res.writeHead(statusCode, headers);

    if (utf8Body) {
        res.end(utf8Body);
    } else {
        res.end();
    }
}
