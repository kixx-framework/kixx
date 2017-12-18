'use strict';

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
		/* eslint-disable no-console */
		console.error(`-- Reporting error ${i} of ${errors.length}:`);
		console.error(err.stack);
		console.error(`-- End of error ${i} of ${errors.length} --\n`);
		/* eslint-enable */
	});

	return true;
};
