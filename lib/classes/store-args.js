'use strict';

const ProgrammerError = require(`./programmer-error`);

const {isObject, isNonEmptyString, isBoolean, deepFreeze, clone} = require(`../../library`);

class Payload {
	constructor(spec) {
		Object.defineProperties(this, {
			type: {
				enumerable: true,
				value: spec.type
			},
			id: {
				enumerable: true,
				value: spec.id || null
			},
			attributes: {
				enumerable: true,
				value: spec.attributes || null
			},
			relationships: {
				enumerable: true,
				value: spec.relationships || null
			},
			meta: {
				enumerable: true,
				value: spec.meta || Object.create(null)
			}
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Payload(clone(spec)));
	}
}

class Parameters {
	constructor(spec) {
		Object.defineProperties(this, {
			type: {
				enumerable: true,
				value: spec.type
			},
			id: {
				enumerable: true,
				value: spec.id || null
			},
			include: {
				enumerable: true,
				value: spec.include || null
			},
			cursor: {
				enumerable: true,
				value: spec.cursor || null
			},
			limit: {
				enumerable: true,
				value: spec.limit || null
			}
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Parameters(clone(spec)));
	}
}

class Response {
	constructor(spec) {
		Object.defineProperties(this, {
			data: {
				enumerable: true,
				value: spec.data || null
			},
			included: {
				enumerable: true,
				value: spec.included || []
			},
			cursor: {
				enumerable: true,
				value: spec.cursor || null
			},
			meta: {
				enumerable: true,
				value: spec.meta || []
			}
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Response(clone(spec)));
	}
}

class StoreArgs {
	constructor(spec) {
		Object.freeze(Object.defineProperties(this, {
			operation: {
				enumerable: true,
				value: spec.operation
			},
			transaction: {
				enumerable: true,
				value: spec.transaction
			},
			scope: {
				enumerable: true,
				value: spec.scope
			},
			type: {
				enumerable: true,
				value: spec.type
			},
			payload: {
				enumerable: true,
				value: Payload.create(spec.payload)
			},
			parameters: {
				enumerable: true,
				value: Parameters.create(spec.parameters)
			},
			options: {
				enumerable: true,
				value: deepFreeze(spec.options ? clone(spec.options) : Object.create(null))
			},
			response: {
				enumerable: true,
				value: Response.create(spec.response)
			}
		}));
	}

	setPayload(payload) {
		if (!isObject(payload)) {
			throw new ProgrammerError(
				`Invalid payload Object in StoreArgs#setResponse(payload)`
			);
		}
		if (!isNonEmptyString(payload.type)) {
			throw new ProgrammerError(
				`Invalid payload.type String in StoreArgs#setResponse(payload)`
			);
		}

		return new StoreArgs(Object.assign({}, this, {payload}));
	}

	setResponse(response) {
		if (!isObject(response)) {
			throw new ProgrammerError(
				`Invalid response Object in StoreArgs#setResponse(response)`
			);
		}
		const data = response.data;
		if (data !== null && !isBoolean(data) && !isObject(data) && !Array.isArray(data)) {
			throw new ProgrammerError(
				`Invalid response.data Object/Array in StoreArgs#setResponse(response)`
			);
		}

		return new StoreArgs(Object.assign({}, this, {response}));
	}

	static create(spec) {
		spec = spec || {};

		if (!isNonEmptyString(spec.operation)) {
			throw new ProgrammerError(
				`Invalid spec.operation String in StoreArgs.create(spec)`
			);
		}
		if (!isObject(spec.transaction)) {
			throw new ProgrammerError(
				`Invalid spec.transaction Object in StoreArgs.create(spec)`
			);
		}
		if (!isNonEmptyString(spec.scope)) {
			throw new ProgrammerError(
				`Invalid spec.scope String in StoreArgs.create(spec)`
			);
		}
		if (!spec.parameters && !spec.payload) {
			throw new ProgrammerError(
				`Missing spec.parameters or spec.payload in StoreArgs.create(spec)`
			);
		}

		const parameters = spec.parameters;
		const payload = spec.payload;

		if (parameters && !isNonEmptyString(parameters.type)) {
			throw new ProgrammerError(
				`Invalid spec.parameters.type String in StoreArgs.create(spec)`
			);
		}
		if (payload && !isNonEmptyString(payload.type)) {
			throw new ProgrammerError(
				`Invalid spec.payload.type String in StoreArgs.create(spec)`
			);
		}

		const {operation, transaction, scope, options} = spec;
		const type = parameters ? parameters.type : payload.type;

		return new StoreArgs({
			operation,
			transaction,
			scope,
			type,
			parameters,
			payload,
			options
		});
	}
}

module.exports = StoreArgs;
