import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { renderHtmlErrorPage } from '../../../../../src/app/presentation/lib/html-error-page.js';
import ServerResponse from '../../../../../src/kixx/http-router/server-response.js';


function makeRequest(pathname = '/admin/errors') {
    return {
        headers: new Headers(),
        id: 'request-1',
        url: new URL(pathname, 'https://www.example.com'),
    };
}

function makeContext(implementation) {
    const warnings = [];
    return {
        warnings,
        logger: {
            warn(...args) {
                warnings.push(args);
            },
        },
        getService(name) {
            assertEqual('HyperviewService', name);
            return {
                renderPage: implementation,
            };
        },
    };
}

function makeError() {
    return {
        httpError: true,
        httpStatusCode: 405,
        message: 'Method not allowed',
        allowedMethods: [ 'GET', 'HEAD' ],
    };
}

function errorOptions() {
    return {
        pathname: '/admin/errors',
        baseTemplateId: 'admin.html',
        scope: 'Admin',
    };
}


describe('renderHtmlErrorPage', ({ it }) => {

    it('replaces stale rendering options before rendering the error document', async () => {
        const response = new ServerResponse();
        response.setRenderingOptions({
            pathname: '/failed-page',
            partial: 'results',
            usePageCache: true,
        });
        const context = makeContext(async (_context, options) => {
            assertEqual('/admin/errors', options.pathname);
            assertEqual('admin.html', options.baseTemplateId);
            assertEqual(false, options.allowJsonResponse);
            assertEqual(false, options.usePageCache);
            assertEqual(undefined, options.partial);
            return { type: 'hypertext', hypertext: '<main>Error</main>' };
        });

        const returned = await renderHtmlErrorPage(
            context,
            makeRequest(),
            response,
            makeError(),
            errorOptions(),
        );

        assertEqual(response, returned);
        assertEqual(405, response.status);
        assertEqual('GET, HEAD', response.headers.get('allow'));
        assertEqual('Method not allowed : Admin', response.props.page.title);
        assertEqual('/admin/errors', response.renderingOptions.pathname);
    });

    it('returns false without rendering a JSON error request', async () => {
        const context = makeContext(async () => {
            throw new Error('should not render');
        });

        const result = await renderHtmlErrorPage(
            context,
            makeRequest('/admin/errors.JSON'),
            new ServerResponse(),
            makeError(),
            errorOptions(),
        );

        assertEqual(false, result);
    });

    it('returns false when the error page cannot render for an expected reason', async () => {
        const context = makeContext(async () => {
            const error = new Error('Page not found');
            error.expected = true;
            throw error;
        });

        const result = await renderHtmlErrorPage(
            context,
            makeRequest(),
            new ServerResponse(),
            makeError(),
            errorOptions(),
        );

        assertEqual(false, result);
        assertEqual(1, context.warnings.length);
    });

    it('rethrows an unexpected rendering failure', async () => {
        const failure = new Error('render failure');
        const context = makeContext(async () => {
            throw failure;
        });

        let caught;
        try {
            await renderHtmlErrorPage(
                context,
                makeRequest(),
                new ServerResponse(),
                makeError(),
                errorOptions(),
            );
        } catch (error) {
            caught = error;
        }

        assertEqual(failure, caught);
        assertEqual(1, context.warnings.length);
    });
});
