'use strict';

const has = Object.prototype.hasOwnProperty;

class ImmutableHash {
	constructor(props = {}) {
		Object.assign(this, props);
		Object.freeze(this);
	}

	set(props) {
		const keys = Object.keys(props);
		for (let i = keys.length - 1; i >= 0; i--) {
			if (has.call(this, keys[i])) {
				throw new Error(
					`The '${keys[i]}' property is already set. Cannot set an existing property on an ImmutableHash instance.`
				);
			}
		}
		return new ImmutableHash(Object.assign({}, this, props));
	}

	static create(props) {
		return new ImmutableHash(props);
	}
}

module.exports = ImmutableHash;
