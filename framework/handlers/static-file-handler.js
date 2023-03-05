// @ts-check

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
    OperationalError,
    ProgrammerError,
    BadRequestError,
    NotFoundError } from 'kixx-server-errors';
import KixxAssert from 'kixx-assert';
import { getContentTypeForFileExtension } from '../lib/mimetypes.js';
import { onStreamFinished } from '../lib/file-utils.js';

const { isNonEmptyString } = KixxAssert.helpers;

// eslint-disable-next-line no-useless-escape
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_\.\-]/i;

export function createStaticFileHandler(options) {
    options = options || {};

    const { publicDirectory } = options;

    if (!isNonEmptyString(publicDirectory)) {
        throw new ProgrammerError(
            'The options.publicDirectory file path must be passed to createStaticFileHandler()'
        );
    }

    async function handleRequest(context) {
        const { method, url } = context.request;
        const { pathname } = url;

        // Two dots or two slashes are always invalid
        if (pathname.includes('..') || pathname.includes('//')) {
            throw new BadRequestError(`Invalid static file path: ${ pathname }`);
        }

        const lastSlashIndex = pathname.lastIndexOf('/');
        const dotIndex = pathname.indexOf('.');

        // Dots are only valid if they are in the filename; after the last slash.
        if (dotIndex !== -1 && dotIndex < lastSlashIndex) {
            throw new BadRequestError(`Invalid static file path: ${ pathname }`);
        }

        const parts = pathname.split('/');

        for (let i = 0; i < parts.length; i = i + 1) {
            const part = parts[i];

            // In addition to the list, a single dot as a path part is invalid.
            if (DISALLOWED_STATIC_PATH_CHARACTERS.test(part) || part === '.') {
                throw new BadRequestError(`Invalid static file path: ${ pathname }`);
            }
        }

        const filepath = path.join(publicDirectory, ...parts);

        let stat;

        try {
            stat = await fsp.stat(filepath);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                throw new NotFoundError(`Location not found: ${ pathname }`);
            }

            throw new OperationalError(
                'Unable to stat file from static file handler',
                { cause, info: { pathname, filepath } }
            );
        }

        if (!stat.isFile()) {
            throw new NotFoundError(`Location not found: ${ pathname }`);
        }

        const extname = path.extname(filepath).replace(/^./, '');
        const contentType = getContentTypeForFileExtension(extname) || 'application/octet-stream';

        const requestOptions = {
            status: 200,
            // @ts-ignore error TS2345: Argument of type 'blah blah' is not assignable to parameter of type 'HeadersInit
            headers: new Headers({
                'content-type': contentType,
                'content-length': stat.size,
            }),
        };

        if (method === 'HEAD') {
            return context.respondWith(null, requestOptions);
        }

        const readStream = fs.createReadStream(filepath);

        onStreamFinished(readStream, () => {
            readStream.destroy();
        });

        return context.respondWith(readStream, requestOptions);
    }

    return {
        GET: handleRequest,
        HEAD: handleRequest,
    };
}
