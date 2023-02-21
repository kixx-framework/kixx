import { createStackedError } from '../error-handling.mjs';
import Page from '../entity-types/page.mjs';
import BasePageView from '../views/base-page-view.mjs';

export function createTemplatePageHandler(params) {
	const {
		templateStore,
		recordStore,
		imageBaseURL,
		templateId,
		pageId,
	} = params;

	async function handleRequest(req, res, handleError) {
		try {
			const template = await templateStore.getTemplate(templateId);
			const [ page, includes ] = await recordStore.get(Page.type, pageId, { include: true });

			const view = BasePageView.fromEntity(page, includes)
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
