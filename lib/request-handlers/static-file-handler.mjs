import fs from 'node:fs';
import path from 'node:path';
import { OperationalError, BadRequestError, NotFoundError } from 'kixx-server-errors';
import { ErrorEvent } from '../events.mjs';
import { getContentTypeForFileExtension } from '../mime-types.mjs';
import { onStreamFinished } from '../file-utils.mjs';

// eslint-disable-next-line no-useless-escape
const DISALLOWED_STATIC_PATH_CHARACTERS = /[^a-z0-9_\.\-]/i;

export function createStaticFileHandler(params) {
	const {
		eventBus,
		publicDirectory,
	} = params;

	function handleRequest(req, res, handleError) {
		const { method, pathname } = req;

		// Two dots or two slashes are always invalid
		if (pathname.includes('..') || pathname.includes('//')) {
			handleError(
				req,
				res,
				new BadRequestError(`Invalid static file path: ${ pathname }`)
			);
		}

		const lastSlashIndex = pathname.lastIndexOf('/');
		const dotIndex = pathname.indexOf('.');

		// Dots are only valid if they are in the filename; after the last slash.
		if (dotIndex !== -1 && dotIndex < lastSlashIndex) {
			handleError(
				req,
				res,
				new BadRequestError(`Invalid static file path: ${ pathname }`)
			);
			return;
		}

		const parts = pathname.split('/');

		for (let i = 0; i < parts.length; i = i + 1) {
			const part = parts[i];

			// In addition to the list, a single dot as a path part is invalid.
			if (DISALLOWED_STATIC_PATH_CHARACTERS.test(part) || part === '.') {
				handleError(
					req,
					res,
					new BadRequestError(`Invalid static file path: ${ pathname }`)
				);
				return;
			}
		}

		const filepath = path.join(publicDirectory, ...parts);

		fs.stat(filepath, (cause, stat) => {
			if (cause) {
				if (cause.code === 'ENOENT') {
					handleError(
						req,
						res,
						new NotFoundError(`Location not found: ${ pathname }`)
					);
					return;
				}

				const error = new OperationalError(
					'Unable to stat file from static file handler',
					{ cause, info: { pathname, filepath } }
				);

				handleError(req, res, error);
				return;
			}

			if (!stat.isFile()) {
				handleError(
					req,
					res,
					new NotFoundError(`Location not found: ${ pathname }`)
				);
				return;
			}

			const extname = path.extname(filepath).replace(/^./, '');

			const contentType = getContentTypeForFileExtension(extname) || 'application/octet-stream';

			res.setHeader('content-type', contentType);
			res.setHeader('content-length', stat.size);

			if (method === 'HEAD') {
				res.writeHead(200).end();
				return;
			}

			const readStream = fs.createReadStream(filepath);
			const writeStream = res.getWriteStream();

			// eslint-disable-next-line no-shadow
			readStream.on('error', (cause) => {
				const error = new OperationalError(
					'Encountered read stream error event while serving static file',
					{ cause, info: { pathname, filepath } }
				);

				eventBus.emit(new ErrorEvent(error));

				handleError(req, res, error);
			});

			readStream.pipe(writeStream);

			onStreamFinished(writeStream, () => {
				writeStream.destroy();
				readStream.destroy();
			});
		});
	}

	return {
		GET: handleRequest,
		HEAD: handleRequest,
	};
}
