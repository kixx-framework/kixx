import { Logger, streams } from 'kixx-logger';
import BaseComponent from '../../lib/base-component';

function errorSerializer(val) {
	const err = val || {};
	return `${ err.name || 'NoErrorName' } ${ err.code || 'NoErrorCode' } ${ err.message || 'NoErrorMessage' }`;
}

export default class LoggerComponent extends BaseComponent {
	#logger = null;

	initialize(context) {
		const { environment } = context;

		const level = environment === 'development'
			? Logger.Levels.DEBUG
			: Logger.Levels.INFO;

		const makePretty = level === Logger.Levels.DEBUG;

		const stream = streams.JsonStdout.create({ makePretty });

		this.#logger = Logger.create({
			name: 'webserver',
			level,
			stream,
			serializers: { cause: errorSerializer },
		});
	}

	getRootLogger() {
		return this.#logger;
	}

	createChildLogger(name, options) {
		options = Object.assign({}, options || {}, { name });
		return this.#logger.createChild(options);
	}
}
