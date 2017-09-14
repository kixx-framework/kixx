'use strict';

exports.parseIncludeQuery = (req) => {
	return (req.query.include ? req.query.include.split(`,`) : []).filter((s) => Boolean(s));
};
