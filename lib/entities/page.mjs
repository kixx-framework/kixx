import BaseEntity from './base-entity.mjs';

export default class Page extends BaseEntity {

	static type = 'page';

	mergeParents() {
		const parents = [];

		function walkTree(page) {
			if (page.relationships && page.relationships.parent) {
				const { parent } = page.relationships;

				parents.unshift(parent);
				walkTree(parent);
			}
		}

		walkTree(this);

		const mergedParents = parents.reduce((obj, parent) => {
			return Object.assign(obj, parent);
		}, {});

		const spec = Object.assign(mergedParents, this);

		return new this.constructor(spec);
	}
}
