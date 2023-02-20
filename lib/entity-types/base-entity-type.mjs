export default class BaseEntityType {

	static includedAttributes = null;

	constructor(spec) {
		Object.assign(this, spec);
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
