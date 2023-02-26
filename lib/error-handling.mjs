import {
	OperationalError,
	ProgrammerError
} from 'kixx-server-errors';

export function wrapError(message, cause) {
	if (cause instanceof StackedError) {
		return cause;
	}

	if (cause.code) {
		return new OperationalError(message || cause.message);
	}

	return new ProgrammerError(message || cause.message);
}

export function createStackedError() {
}

export function createWebRequestErrorHandler(eventBus, formatError, name) {

	return function webRequestErrorHandler(req, res, cause) {
		try {
			let error = wrapError(`Error in "${ name }" web handler`, cause);

			if (isProgrammerError(error) && !error.fatal) {
				// Ensure ProgrammerError is always fatal.
				error = new ProgrammerError(error.message, { cause: error, fatal: true });
			}

			const statusCode = error.statusCode || 500;
			const { headers, body } = formatError(error);

			res.writeHead(statusCode, headers, body).writeBody(body);

			if (statusCode >= 500) {
				eventBus.emit(new ErrorEvent(error));
			}
		} catch (handlerError) {
			const error = new ProgrammerError(
				handlerError.message,
				{ cause: handlerError, fatal: true }
			);

			res.writeHTML(500, '<p>Unexpected server error</p>\n');
			eventBus.emit(new ErrorEvent(error));
		}
	};
}

export function wrapWebHandler(name, errorHandler, handler) {

	return function wrappedWebHandler(req, res) {
		handleError = errorHandler || handleError;
		let promise;

		try {
			promise = handler(req, res);
		} catch (cause) {
			const error = createStackedError(cause, errorMessage);
		}
	};
}
