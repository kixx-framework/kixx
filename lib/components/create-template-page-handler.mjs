import { createStackedError } from '../error-handling.mjs';
import Page from '../entities/page.mjs';
import BasePageView from '../views/base-page-view.mjs';

export default function createTemplatePageHandler(params) {
	const {
		templateStore,
		recordStore,
		imageBaseURL,
		pageId,
	} = params;

	async function handleRequest(req, res, handleError) {
		try {
			const template = await templateStore.getTemplate(pageId);
			const data = await recordStore.get('page', pageId, { include: true });

			console.log(data);

			const page = Page.fromDatabaseRecord(data).mergeParents();

			console.log(JSON.stringify(page, null, 2));

			const view = BasePageView.fromEntity(page.toJSON())
				.addRequest(req)
				.addImageBaseURL(imageBaseURL);

			console.log(JSON.stringify(view, null, 2));

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
