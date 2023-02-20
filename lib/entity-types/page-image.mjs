import BaseEntityType from './base-entity-type.mjs';

export default class PageImage extends BaseEntityType {

	static type = 'page-image';

	static includedAttributes = [
		'title',
		'details',
		'contentType',
		'filename',
	];
}
