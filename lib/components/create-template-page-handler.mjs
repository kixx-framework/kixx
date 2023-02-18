import { OperationalError, ProgrammerError } from 'kixx-server-errors';
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
			let error;
			if (cause.code) {
				// If there is a code, then assume this is an OperationalError
				error = new OperationalError(
					'TemplatePageHandler encountered an error',
					{ cause }
				);
			} else {
				// If there is no code, then assume this is a ProgrammerError.
				error = new ProgrammerError(
					'TemplatePageHandler encountered an error',
					{ cause, fatal: true }
				);
			}
			handleError(req, res, error);
		}
	}

	return {
		GET: handleRequest,
		HEAD: handleRequest,
	};
}
