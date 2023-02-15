
export class ErrorEvent {
	static NAME = 'error';

	constructor(cause) {
		cause = cause || {};

		this.name = this.constructor.NAME;
		this.type = 'ERROR';
		this.message = cause.message || 'error event';
		this.info = cause.info || {};
		this.cause = cause;
		this.fatal = Boolean(cause.fatal);

		Object.freeze(this);
	}
}

export class InfoEvent {
	static NAME = 'info';

	constructor(spec) {
		spec = spec || {};

		this.name = this.constructor.NAME;
		this.type = spec.type || 'INFO';
		this.message = spec.message || 'info event';
		this.info = spec.info || {};
		this.cause = spec.cause || null;

		Object.freeze(this);
	}
}

export class DebugEvent {
	static NAME = 'debug';

	constructor(spec) {
		spec = spec || {};

		this.name = this.constructor.NAME;
		this.type = spec.type || 'DEBUG';
		this.message = spec.message || 'debug event';
		this.info = spec.info || {};
		this.cause = spec.cause || null;

		Object.freeze(this);
	}
}
