import { createStackedError } from '../error-handling.mjs';
import Page from '../entities/page.mjs';
import BasePageView from '../views/base-page-view.mjs';

export default function createTemplatePageHandler(params) {
	const {
		templateStore,
		pageDataStore,
		imageBaseURL,
		pageId,
	} = params;

	async function handleRequest(req, res, handleError) {
		try {
			const template = await templateStore.getTemplate(pageId);
			const data = await pageDataStore.get('page', pageId, { include: true });

			const page = Page.fromDatabaseRecord(data).mergeParents();

			const view = BasePageView.fromEntity(page.toJSON())
				.addRequest(req)
				.addImageBaseURL(imageBaseURL);

			const html = template(view.toJSON());

			res.writeHTML(200, html);
		} catch (cause) {
			const error = createStackedError(
				cause,
				'TemplatePageHandler encountered an error'
			);

			handleError(req, res, error);
		}
	}

	return {
		GET: handleRequest,
		HEAD: handleRequest,
	};
}
