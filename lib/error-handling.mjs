import { OperationalError, ProgrammerError } from 'kixx-server-errors';

export function createStackedError(cause, message, spec) {
	message = message || cause.message;
	spec = Object.assign({}, spec, { cause });

	if (cause.code) {
		// If there is a code, then assume this is an OperationalError
		return new OperationalError(message, spec, createStackedError);
	}

	// If there is no code, then assume this is a ProgrammerError.
	spec.fatal = true;
	return new ProgrammerError(message, spec, createStackedError);
}
