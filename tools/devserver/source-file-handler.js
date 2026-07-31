import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentType } from '../../src/kixx/static-file-server/mime-types.js';
import validatePathname from '../../src/kixx/utils/validate-pathname.js';


const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIRECTORY = path.resolve(THIS_DIRECTORY, '..', '..', 'src');

const SOURCE_FILE_ROUTES = [
    createSourceFileRoute('stylesheets'),
    createSourceFileRoute('javascript'),
];

/**
 * Serves editable browser assets directly from their source directory.
 *
 * Recognized stylesheet and JavaScript paths bypass the app server and use a
 * no-cache policy so source edits appear on the next reload. Unrecognized
 * paths are left for the caller to proxy.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} pathname - Request pathname after any asset namespace has been removed
 * @returns {Promise<boolean>} Whether the request pathname was handled
 */
export async function serveSourceFile(request, response, pathname) {
    const route = SOURCE_FILE_ROUTES.find((candidate) => {
        return pathname.startsWith(candidate.urlPrefix);
    });

    if (!route) {
        return false;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, {
            'allow': 'GET, HEAD',
            'content-type': 'text/plain; charset=utf-8',
        });
        response.end('Method Not Allowed\n');
        return true;
    }

    const key = pathname.slice(route.urlPrefix.length);

    let resolvedPath;
    try {
        validatePathname(key);
        resolvedPath = path.resolve(route.rootDirectory, key);
    } catch {
        respondWithText(response, 400, 'Bad Request');
        return true;
    }

    // Defense in depth alongside validatePathname(): refuse to serve anything
    // that resolves outside the selected source root.
    if (resolvedPath !== route.rootDirectory
        && !resolvedPath.startsWith(route.rootDirectory + path.sep)) {
        respondWithText(response, 400, 'Bad Request');
        return true;
    }

    let contents;
    try {
        contents = await fs.readFile(resolvedPath);
    } catch (cause) {
        // A missing file, a missing parent directory, or a request for a
        // directory itself are all ordinary "not found" outcomes here.
        if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'EISDIR') {
            respondWithText(response, 404, 'Not Found');
            return true;
        }
        throw cause;
    }

    response.writeHead(200, {
        'content-type': getContentType(pathname),
        'content-length': contents.length,
        // Always fetch fresh in dev rather than serving a stale cached copy
        // of a browser asset that was just edited.
        'cache-control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
    return true;
}

function createSourceFileRoute(directoryName) {
    return {
        urlPrefix: `/${ directoryName }/`,
        rootDirectory: path.join(SOURCE_DIRECTORY, directoryName),
    };
}

function respondWithText(response, status, message) {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`${ message }\n`);
}
