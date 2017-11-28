'use strict';

const {StackedError} = require(`./classes/stacked-error`);

module.exports = function reportFullStackTrace(err) {
	if (!err) return false;

	const errors = Array.isArray(err) ? err : [err];

	errors.forEach((err, i) => {
		i += 1;
		/* eslint-disable no-console */
		console.error(`-- Reporting server Error ${i} of ${errors.length}:`);
		console.error(StackedError.getFullStack(err));
		console.error(`-- End of server error ${i} of ${errors.length} --\n`);
		/* eslint-enable */
	});

	return true;
};
