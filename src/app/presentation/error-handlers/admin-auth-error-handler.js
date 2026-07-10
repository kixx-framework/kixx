import { renderHtmlErrorPage } from '../lib/html-error-page.js';

export async function adminAuthErrorHandler(context, request, response, error) {
    return await renderHtmlErrorPage(context, request, response, error, '/login/admin/errors', 'Admin');
}
