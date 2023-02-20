export default class BasePageView {

	static knownAttributes = [
		'id',
		'canonical_url',
		'page_type',
		'page_title',
		'page_description',
		'page_image',
		'hero_image',
		'caching',
		'rendering',
		'created',
		'updated',
	];

	#request = null;
	#imageBaseURL = null;

	constructor(spec) {
		Object.assign(this, spec);
	}

	addRequest(request) {
		this.#request = request;
		this.canonical_url = request.canonicalURL;
		return this;
	}

	addImageBaseURL(imageBaseURL) {
		this.#imageBaseURL = imageBaseURL;
		return this.mapPageImage(imageBaseURL).mapHeroImage(imageBaseURL);
	}

	mapPageImage(imageBaseURL) {
		if (this.page_image) {
			this.page_image.url = `${ imageBaseURL }/${ this.page_image.filename }`;
		}
		return this;
	}

	mapHeroImage(imageBaseURL) {
		if (this.hero_image) {
			this.hero_image.url = `${ imageBaseURL }/${ this.hero_image.filename }`;
		}
		return this;
	}

	toJSON() {
		return structuredClone(this);
	}

	static fromEntity(page, includes) {
		const SubClass = this;
		const pageData = page.toJSON();
		const includesData = includes.map((x) => x.toJSON());
		const spec = mergePageData(SubClass.knownAttributes, pageData, includesData);

		return new SubClass(spec);
	}
}

function mergePageData(keys, pageData, includes) {
	const objects = getParents(pageData, includes);

	return objects.reduce((target, source) => {

		keys.forEach((key) => {
			assignValueIfExists(target, source, key);
		});

		return target;
	}, {});
}

function assignValueIfExists(target, source, key) {
	if (source[key]) {
		target[key] = source[key];
	}
	return target;
}

function getParents(pageData, includes) {
	const parents = [ pageData ];

	function findRelatedData({ type, id }) {
		return includes.find((data) => {
			return data.type === type && data.id === id;
		});
	}

	function walkTree(data) {
		if (data.relationships && data.relationships.pageImage) {
			const page_image = findRelatedData(data.relationships.pageImage);
			parents.unshift({ page_image });
		}
		if (data.relationships && data.relationships.heroImage) {
			const hero_image = findRelatedData(data.relationships.heroImage);
			parents.unshift({ hero_image });
		}
		if (data.relationships && data.relationships.parent) {
			const parent = findRelatedData(data.relationships.parent);
			parents.unshift(parent || {});
			walkTree(parent);
		}
	}

	walkTree(pageData);

	return parents;
}
