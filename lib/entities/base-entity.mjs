export default class BaseEntity {

	static includedAttributes = null;

	constructor(spec) {
		Object.assign(this, spec);
	}

	toJSON() {
		return structuredClone(this);
	}

	static fromDatabaseRecord(record) {
		const SubClass = this;
		const includedAttributes = SubClass.includedAttributes;

		let spec;

		if (Array.isArray(includedAttributes)) {
			spec = includedAttributes.reduce((target, key) => {
				target[key] = structuredClone(record[key]);
				return target;
			}, {});
		} else {
			spec = structuredClone(record);
		}

		spec.scope = record.scope;
		spec.type = SubClass.type;
		spec.id = record.id;
		spec.relationships = record.relationships || {};
		spec.created = record.created;
		spec.updated = record.updated;

		return new SubClass(spec);
	}
}
