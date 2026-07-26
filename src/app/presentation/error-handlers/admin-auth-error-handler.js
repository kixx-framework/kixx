import { renderHtmlErrorPage } from '../lib/html-error-page.js';

export default async function adminAuthErrorHandler(context, request, response, error) {
    return await renderHtmlErrorPage(context, request, response, error, '/login/admin/errors', 'Admin');
}
