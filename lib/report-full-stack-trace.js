'use strict';

const {isNonEmptyString} = require(`../library`);

const {EOL} = require(`os`);

function getErrorsList(err) {
	if (Array.isArray(err.errors)) {
		return err.errors;
	}
	if (Array.isArray(err)) {
		return err;
	}
	return [err];
}

module.exports = function reportFullStackTrace(err, message) {
	if (!err) return false;

	message = isNonEmptyString(message) ? `${message}:${EOL}` : ``;
	const errors = getErrorsList(err);

	errors.forEach((err, i) => {
		i += 1;
		// Use a single call to stderr.write() to avoid the message being split due to another
		// turn of the event loop writing to stderr.
		let msg = i === 1 ? message : ``;
		msg = `${msg}-- Reporting error ${i} of ${errors.length}:${EOL}`;
		msg = `${msg}${err.stack}${EOL}-- End of error ${i} of ${errors.length} --${EOL}`;
		process.stderr.write(msg);
	});

	return true;
};
