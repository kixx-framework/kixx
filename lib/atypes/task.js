'use strict';


class Task {
	constructor(fn) {
		if (typeof fn !== 'function') {
			throw new TypeError('Task constructor takes a function as the only argument');
		}

		Object.defineProperties(this, {
			_fork: {
				value: fn
			}
		});
	}

	inspect() {
		return 'Task(?)';
	}

	fork(reject, resolve) {
		let pending = true;

		function safeReject(e) {
			if (pending) {
				reject(e);
				pending = false;
			}
		}

		function safeResolve(x) {
			if (pending) {
				resolve(x);
				pending = false;
			}
		}

		try {
			this._fork(safeReject, safeResolve);
		} catch (err) {
			safeReject(err);
		}

		return this;
	}

	map(fn) {
		return new Task((reject, resolve) => {
			return this.fork(
				reject,
				(x) => resolve(fn(x))
			);
		});
	}

	bimap(sad, happy) {
		return new Task((reject, resolve) => {
			return this.fork(
				(err) => reject(sad(err)),
				(x) => resolve(happy(x))
			);
		});
	}

	chain(fn) {
		return new Task((reject, resolve) => {
			return this.fork(
				reject,
				(x) => fn(x).fork(reject, resolve)
			);
		});
	}

	static isTask(x) {
		if (!x) return false;
		if (x instanceof Task) return true;

		return typeof x.fork === 'function'
			&& typeof x.map === 'function'
			&& typeof x.bimap === 'function'
			&& typeof x.chain === 'function';
	}

	static reject(x) {
		return new Task((reject) => reject(x));
	}

	static of(x) {
		return new Task((reject, resolve) => resolve(x));
	}
}

Task.prototype.toString = Task.prototype.inspect;

module.exports = Task;
