import { NotFoundError } from '../../errors/mod.js';
import { assertNonEmptyString } from '../../assertions/mod.js';


export default function PageHandler(spec) {
    assertNonEmptyString(spec.viewService, 'viewService is required');

    return async function pageHandler(context, request, response) {
        const viewService = context.getService(spec.viewService);

        const pageData = await viewService.getPageData(request.url.pathname, response.props);

        if (request.isRequestForJSON()) {
            return response.respondWithJSON(200, pageData, { whiteSpace: 4 });
        }

        const [ body, template ] = await Promise.all([
            viewService.getPageMarkup(request.url.pathname, pageData),
            viewService.getBaseTemplate(pageData.baseTemplateId),
        ]);

        if (!body) {
            throw new NotFoundError(`no page body found for ${ request.url.pathname }`);
        }
        if (!template) {
            throw new NotFoundError(`no base template found for ${ request.url.pathname }`);
        }

        const ctx = Object.assign({}, pageData, { body });
        const html = template(ctx);

        return response.respondWithHTML(200, html);
    };
}
