import { assertNonEmptyString } from '../../assertions/mod.js';


export default function PageErrorHandler(spec) {
    assertNonEmptyString(spec.viewService, 'viewService is required');

    return async function pageErrorHandler(context, request, response, error) {
        const { logger } = context;
        const viewService = context.getService(spec.viewService);
        const html = await viewService.renderMarkupForError(error);

        const statusCode = error.httpStatusCode || 500;

        if (statusCode > 499) {
            logger.error('page handling error', { requestId: request.id }, error);
        }

        if (statusCode === 405 && error.allowedMethods.length) {
            response.setHeader('Allow', error.allowedMethods.join(', '));
        }

        return response.respondWithHTML(statusCode, html);
    };
}
