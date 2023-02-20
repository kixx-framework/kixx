import { createStackedError } from '../error-handling.mjs';
import Page from '../entities/page.mjs';
import BasePageView from '../views/base-page-view.mjs';

export function createTemplatePageHandler(params) {
	const {
		templateStore,
		recordStore,
		imageBaseURL,
		pageId,
	} = params;

	async function handleRequest(req, res, handleError) {
		try {
			const template = await templateStore.getTemplate(pageId);
			const [ record, includes ] = await recordStore.get('page', pageId, { include: true });

			const page = Page.fromDatabaseRecord(record);

			// console.log(JSON.stringify(page, null, 2));

			// const view = BasePageView.fromEntity(page.toJSON())
			// 	.addRequest(req)
			// 	.addImageBaseURL(imageBaseURL);

			// console.log(JSON.stringify(view, null, 2));

			// const html = template(view.toJSON());

			const html = 'foo';

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
