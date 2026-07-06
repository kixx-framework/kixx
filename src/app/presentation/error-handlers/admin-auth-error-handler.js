import { renderHtmlErrorPage } from '../lib/html-error-page.js';

export function adminAuthErrorHandler(context, request, response, error) {
    return renderHtmlErrorPage(context, request, response, error, '/login/admin/errors', 'Admin');
}
