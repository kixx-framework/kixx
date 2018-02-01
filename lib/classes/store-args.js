'use strict';

const ProgrammerError = require(`./programmer-error`);

const {clone, deepFreeze, isBoolean, isNonEmptyString, isObject} = require(`../../library`);

class Payload {
	constructor(spec) {
		Object.assign(this, {
			type: spec.type,
			id: spec.id || null,
			attributes: spec.attributes || Object.create(null),
			relationships: spec.relationships || Object.create(null),
			meta: spec.meta || Object.create(null)
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Payload(spec));
	}
}

class Parameters {
	constructor(spec) {
		Object.assign(this, {
			type: spec.type,
			id: spec.id || null,
			include: spec.include || null,
			cursor: spec.cursor || null,
			limit: spec.limit || null
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Parameters(spec));
	}
}

class Response {
	constructor(spec) {
		Object.assign(this, {
			data: spec.data || null,
			included: spec.included || [],
			cursor: spec.cursor || null,
			meta: spec.meta || []
		});
	}

	static create(spec) {
		if (!isObject(spec)) return null;
		return deepFreeze(new Response(spec));
	}
}

class StoreArgs {
	constructor(spec) {
		Object.assign(this, {
			operation: spec.operation,
			transaction: spec.transaction,
			scope: spec.scope,
			type: spec.type,
			payload: Payload.create(spec.payload),
			parameters: Parameters.create(spec.parameters),
			options: deepFreeze(spec.options ? clone(spec.options) : Object.create(null)),
			response: Response.create(spec.response)
		});

		Object.freeze(this);
	}

	setParameters(parameters) {
		if (!isObject(parameters)) {
			throw new ProgrammerError(
				`Invalid parameters Object in StoreArgs#setParameters(parameters)`
			);
		}
		if (!isNonEmptyString(parameters.type)) {
			throw new ProgrammerError(
				`Invalid parameters.type String in StoreArgs#setParameters(parameters)`
			);
		}

		return new StoreArgs(Object.assign({}, this, {parameters}));
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
