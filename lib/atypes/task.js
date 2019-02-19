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
		try {
			this._fork(reject, resolve);
		} catch (err) {
			reject(err);
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

	chain(fn) {
		return new Task((reject, resolve) => {
			return this.fork(
				reject,
				(x) => fn(x).fork(reject, resolve)
			);
		});
	}

	static of(x) {
		return new Task((reject, resolve) => resolve(x));
	}
}

Task.prototype.toString = Task.prototype.inspect;

module.exports = Task;
