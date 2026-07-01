import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentType } from '../../src/kixx/static-file-server/mime-types.js';
import validatePathname from '../../src/kixx/utils/validate-pathname.js';


const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const STYLESHEETS_ROOT = path.resolve(THIS_DIRECTORY, '..', '..', 'src', 'stylesheets');

const URL_PREFIX = '/stylesheets/';

/**
 * Whether a request pathname should be served from src/stylesheets/ instead
 * of being proxied to the app server child process.
 * @param {string} pathname - request.url.pathname
 * @returns {boolean}
 */
export function isStylesheetRequest(pathname) {
    return pathname.startsWith(URL_PREFIX);
}

/**
 * Serves one file from src/stylesheets/ directly, bypassing the app server
 * proxy entirely. Stylesheet source files are edited directly under
 * src/stylesheets/ and are not copied into the app server's served public/
 * directory by any build step, so reading them straight from source here is
 * what lets CSS edits show up on the next browser reload.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} pathname - request.url.pathname, already known to start with /stylesheets/
 * @returns {Promise<void>}
 */
export async function serveStylesheetFile(request, response, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, {
            'allow': 'GET, HEAD',
            'content-type': 'text/plain; charset=utf-8',
        });
        response.end('Method Not Allowed\n');
        return;
    }

    const key = pathname.slice(URL_PREFIX.length);

    let resolvedPath;
    try {
        validatePathname(key);
        resolvedPath = path.resolve(STYLESHEETS_ROOT, key);
    } catch {
        respondWithText(response, 400, 'Bad Request');
        return;
    }

    // Defense in depth alongside validatePathname(): refuse to serve anything
    // that resolves outside the stylesheets root.
    if (resolvedPath !== STYLESHEETS_ROOT && !resolvedPath.startsWith(STYLESHEETS_ROOT + path.sep)) {
        respondWithText(response, 400, 'Bad Request');
        return;
    }

    let contents;
    try {
        contents = await fs.readFile(resolvedPath);
    } catch (cause) {
        // A missing file, a missing parent directory, or a request for a
        // directory itself are all ordinary "not found" outcomes here.
        if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'EISDIR') {
            respondWithText(response, 404, 'Not Found');
            return;
        }
        throw cause;
    }

    response.writeHead(200, {
        'content-type': getContentType(pathname),
        'content-length': contents.length,
        // Always fetch fresh in dev rather than serving a stale cached copy
        // of a stylesheet that was just edited.
        'cache-control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
}

function respondWithText(response, status, message) {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`${ message }\n`);
}
