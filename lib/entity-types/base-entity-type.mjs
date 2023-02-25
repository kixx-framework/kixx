import { ValidationError } from 'kixx-server-errors';
import { mergeDeep } from 'kixx-lib-es6';

export default class BaseEntityType {

	static includedAttributes = null;

	constructor(spec) {
		Object.assign(this, spec);
	}

	mergeAttributes(attributes) {
		const SubClass = this.constructor;
		const spec = mergeDeep({}, this, attributes);

		return new SubClass(spec);
	}

	validate() {
		return new ValidationError('Entity validation error');
	}

	validateNew() {
		return new ValidationError('Entity validation error');
	}

	toJSON() {
		const SubClass = this.constructor;

		const keys = Array.isArray(SubClass.includedAttributes)
			? SubClass.includedAttributes
			: Object.keys(this);

		const spec = keys.reduce((target, key) => {
			target[key] = structuredClone(this[key]);
			return target;
		}, {});

		spec.scope = this.scope;
		spec.type = SubClass.type;
		spec.id = this.id;
		spec.created = this.created;
		spec.updated = this.updated;
		spec.relationships = this.relationships || {};

		return spec;
	}

	static fromAttributes(attributes) {
		const SubClass = this;

		const spec = structuredClone(attributes);

		spec.scope = attributes.scope;
		spec.type = SubClass.type;
		spec.id = attributes.id;
		spec.relationships = attributes.relationships || {};
		spec.created = attributes.created;
		spec.updated = attributes.updated;

		return new SubClass(spec);
	}

	static fromDatabaseRecord(record) {
		const SubClass = this;

		const spec = structuredClone(record);

		spec.scope = record.scope;
		spec.type = SubClass.type;
		spec.id = record.id;
		spec.relationships = record.relationships || {};
		spec.created = record.created;
		spec.updated = record.updated;

		return new SubClass(spec);
	}
}
