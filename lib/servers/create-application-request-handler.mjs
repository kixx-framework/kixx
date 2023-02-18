import {
	NotFoundError,
	MethodNotAllowedError,
	BadRequestError
} from 'kixx-server-errors';

import { ErrorEvent } from '../events.mjs';
import WrappedRequest from './request.mjs';
import WrappedResponse from './response.mjs';

export default function createApplicationRequestHandler(params) {
	const { eventBus, applications } = params;

	function handleError(req, res, cause) {
		switch (cause.name) {
			case NotFoundError.NAME:
				handleNotFoundError(req, res, cause);
				break;
			case MethodNotAllowedError.NAME:
				handleMethodNotAllowedError(req, res, cause);
				break;
			case BadRequestError.NAME:
				handleBadRequestError(req, res, cause);
				break;
			default:
				handleInternalServerError(req, res, cause);
		}
	}

	function handleNotFoundError(req, res) {
		const { pathname } = req;

		res.writeHTML(
			404,
			`<p>Requested URL could not be found: ${ pathname }</p>\n`
		);
	}

	function handleMethodNotAllowedError(req, res, cause) {
		const { method } = req;
		const info = cause.info || {};

		let allowedMethods = '';
		let message = '';

		if (Array.isArray(info.allowedMethods)) {
			allowedMethods = info.allowedMethods.join();
			message = ` Allowed methods: ${ allowedMethods }`;
		}

		res
			.setHeader('Allowed', allowedMethods)
			.writeHTML(405, `<p>Requested Method ${ method } is not allowed.${ message }</p>\n`);
	}

	function handleBadRequestError(req, res, cause) {
		res.writeHTML(
			400,
			`<p>Bad Request: ${ cause.message }</p>\n`
		);
	}

	function handleInternalServerError(req, res, cause) {
		res.writeHTML(500, '<p>Unexpected server error</p>\n');
		eventBus.emit(new ErrorEvent(cause));
	}

	return function handleApplicationRequest(details, nativeRequest, nativeResponse) {
		const {
			appConfig,
			url,
			originatingPort,
			originatingProtocol,
		} = details;

		const app = applications.get(appConfig.name);

		const req = new WrappedRequest({
			nativeRequest,
			url,
			originatingPort,
			originatingProtocol,
			appConfig,
		});

		const res = new WrappedResponse({ request: req, nativeResponse });

		try {
			app(req, res, handleError);
		} catch (cause) {
			handleError(req, res, cause);
		}
	};
}
