export default class BasePageView {

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

	static fromEntity(pageData) {
		const SubClass = this;

		const spec = Object.assign({}, pageData);
		const relationships = structuredClone(pageData.relationships);

		if (relationships && relationships.pageImage) {
			spec.page_image = relationships.pageImage;
		}

		if (relationships && relationships.heroImage) {
			spec.hero_image = relationships.heroImage;
		}

		return new SubClass(spec);
	}
}
