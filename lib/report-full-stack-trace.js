'use strict';

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

module.exports = function reportFullStackTrace(err) {
	if (!err) return false;

	const errors = getErrorsList(err);

	errors.forEach((err, i) => {
		i += 1;
		// Use a single call to stderr.write() to avoid the message being split due to another
		// turn of the event loop writing to stderr.
		process.stderr.write(`-- Reporting error ${i} of ${errors.length}:${EOL}${err.stack}${EOL}-- End of error ${i} of ${errors.length} --${EOL}`);
	});

	return true;
};
