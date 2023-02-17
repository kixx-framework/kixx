import { Logger, streams } from 'kixx-logger';
import { ENVIRONMENTS } from './constants.mjs';

export default function createLogger({ environment, name }) {
	const level = environment === ENVIRONMENTS.DEVELOPMENT
		? Logger.Levels.DEBUG
		: Logger.Levels.INFO;

	const makePretty = level === Logger.Levels.DEBUG;

	const stream = streams.JsonStdout.create({ makePretty });

	return Logger.create({
		name,
		level,
		stream,
		serializers: {
			cause: errorSerializer,
			err: errorSerializer,
			error: errorSerializer,
		},
	});
}

function errorSerializer(val) {
	const err = val || {};
	return `${ err.name || 'NoErrorName' } ${ err.code || 'NoErrorCode' } ${ err.message || 'NoErrorMessage' }`;
}
