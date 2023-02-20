import BaseEntity from './base-entity.mjs';

export default class Page extends BaseEntity {

	static type = 'page';

	static includedAttributes = [
		'page_type',
		'page_title',
		'page_description',
		'caching',
		'rendering',
	];
}
