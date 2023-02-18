import { NotFoundError, MethodNotAllowedError } from 'kixx-server-errors';
import PathToRegExp from 'path-to-regexp';

export default function createAppRouter(params) {

	const routes = params.routes.map(({ pattern, methods }) => {
		const matcher = PathToRegExp.match(pattern, { decode: decodeURIComponent });
		const allowedMethods = Object.keys(methods);

		return {
			pattern,
			matcher,
			allowedMethods,
			methods,
		};
	});

	return function routeApplicationRequest(req, res, handleError) {
		try {
			const { method, pathname } = req;

			// If the match is not found, this function will throw a NotFoundError.
			const match = findRoute(routes, method, pathname);

			req.pattern = match.pattern;
			req.params = match.params;

			match.handler(req, res, handleError);
		} catch (cause) {
			// TODO: Allow applications to register their own custom error handler.
			handleError(req, res, cause);
		}
	};
}

function findRoute(routes, method, pathname) {
	for (let i = 0; i < routes.length; i = i + 1) {

		const route = routes[i];
		const match = route.matcher(pathname);

		if (match) {
			const { allowedMethods } = route;

			if (allowedMethods.includes(method)) {
				return createMatch(method, route, match);
			}

			throw new MethodNotAllowedError(
				`"${ method }" method is not allowed on ${ pathname }`,
				{ info: { allowedMethods } },
				findRoute
			);
		}
	}

	throw new NotFoundError(`Pathname not present in this application: ${ pathname }`);
}

function createMatch(method, route, match) {
	return {
		pattern: route.pattern,
		params: match.params,
		handler: route.methods[method],
	};
}
