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
		// Using stdout (console.log()) we allow the use of tools like grep to
		// more easily search logs.
		console.log(`-- Reporting error ${i} of ${errors.length}:`);
		console.log(err.stack);
		console.log(`-- End of error ${i} of ${errors.length} --\n`);
		/* eslint-enable */
	});

	return true;
};
