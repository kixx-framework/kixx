import BaseEntityType from './base-entity-type.mjs';

export default class Page extends BaseEntityType {

	static type = 'page';

	static includedAttributes = [
		'page_type',
		'page_title',
		'page_description',
		'caching',
		'rendering',
	];
}
