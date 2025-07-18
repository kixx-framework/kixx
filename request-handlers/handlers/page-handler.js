import { NotFoundError } from '../../errors/mod.js';
import { assertNonEmptyString } from '../../assertions/mod.js';


export default function PageHandler(spec) {
    assertNonEmptyString(spec.viewService, 'viewService is required');

    return async function pageHandler(context, request, response) {
        const pathname = spec.pathname || request.url.pathname;

        const viewService = context.getService(spec.viewService);

        const pageData = await viewService.getPageData(pathname, response.props);

        if (request.isRequestForJSON()) {
            return response.respondWithJSON(200, pageData, { whiteSpace: 4 });
        }

        const [ body, template ] = await Promise.all([
            viewService.getPageMarkup(pathname, pageData),
            viewService.getBaseTemplate(pageData.baseTemplateId),
        ]);

        if (!body) {
            throw new NotFoundError(`no page body found for ${ pathname }`);
        }
        if (!template) {
            throw new NotFoundError(`no base template found for ${ pathname }`);
        }

        const ctx = Object.assign({}, pageData, { body });
        const html = template(ctx);

        return response.respondWithHTML(200, html);
    };
}
