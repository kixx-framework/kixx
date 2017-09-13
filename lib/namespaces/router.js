'use strict';

const R = require(`ramda`);
const Request = require(`../types/request`);
const Response = require(`../types/response`);

exports.createRequestHandler = (router) => {
	const {routes, errorHandlers} = router;

	const findMatch = exports.findMatch(routes);
	const handleError = exports.handleError(errorHandlers);

	return function handleRequest(req, res) {
		req = Request.create(req);
		res = Response.create(res);

		const match = findMatch(req.url.pathname);

		if (match) {
			req = req.setParams(match.params);

			try {
				match.route.handler(req, res, function finalNext(err) {
					if (err) {
						handleError(err, req, res);
					}
				});
			} catch (err) {
				handleError(err, req, res);
			}
		} else {
			const err = new Error(
				`No route found in router for pathname ${req.url.pathname}`
			);
			err.code = `ERR_NOTFOUND`;

			handleError(err, req, res);
		}
	};
};

exports.findMatch = R.curry(function findMatch(routes, path) {
	let i;
	let matches;

	for (i = 0; i < routes.length; i++) {
		const {regexp, keys} = routes[i];
		matches = regexp.exec(path);

		if (matches) {
			// If we matched a route, collect the parameters if there are any and return.
			const params = keys.reduce((params, key, i) => {
				const name = key.name;
				params[name] = matches[i + 1];

				// If the parameter is a number, parse it as such.
				if (/^[\d]+$/.test(params[name])) {
					params[name] = parseInt(params[name], 10);
				}

				// If the parameter is a float, parse it as such.
				if (/^[\d]+.[\d]+$/.test(params[name])) {
					params[name] = parseFloat(params[name]);
				}

				return params;
			}, Object.create(null));

			return {route: routes[i], params};
		}
	}

	return false;
});

exports.handleError = R.curry(function handleError(handlers, err, req, res) {
	if (handlers.length < 1) {
		throw err;
	}

	handlers.forEach((handler) => {
		handler(err, req, res);
	});
});
