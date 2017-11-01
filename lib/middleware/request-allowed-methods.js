'use strict';

const {createTypeChecker, Types} = require(`kixx-type-check`);

const typeCheck = createTypeChecker(
	'request-allowed-methods',
	Types.requiredInstanceOf(App),
	Types.requiredShape({
		methods: Types.requiredArrayOf(Types.requiredString)
	})
);

module.exports = (app, options) => {
	const typeErrors = typeCheck(app, options);

	if (typeErrors) {
		throw new TypeError(typeErrors[0]);
	}

	return function requestAllowedMethods(req, res, next) {
	};
};
