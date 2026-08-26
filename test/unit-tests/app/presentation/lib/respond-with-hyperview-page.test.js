import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import respondWithHyperviewPage from '../../../../../src/app/presentation/lib/respond-with-hyperview-page.js';
import ServerResponse from '../../../../../src/kixx/http-router/server-response.js';


function makeRequest(headers, href) {
    return {
        headers: new Headers(headers),
        url: new URL(href ?? 'https://www.example.com/'),
    };
}

function makeSubject() {
    const calls = [];
    const hyperviewService = {
        async renderPage(context, options) {
            calls.push({ context, options });
            return { type: 'hypertext', hypertext: '<main>Account</main>' };
        },
    };
    const context = {
        getService(name) {
            assertEqual('HyperviewService', name);
            return hyperviewService;
        },
    };

    return { calls, context };
}


describe('respondWithHyperviewPage', ({ it }) => {

    it('applies defaults, response rendering options, and client render modes in order', async () => {
        const { calls, context } = makeSubject();
        const request = makeRequest({
            'kixx-partial': 'client-partial',
            'kixx-boosted': 'true',
        });
        const response = new ServerResponse();
        response.setRenderingOptions({
            pathname: '/response-page',
            partial: 'response-partial',
            skipBaseRender: false,
        });

        const returned = await respondWithHyperviewPage(
            context,
            request,
            response,
            {
                pathname: '/default-page',
                partial: 'default-partial',
                baseTemplateId: 'default.html',
            },
        );

        assertEqual(response, returned);
        assertEqual(1, calls.length);
        assertEqual('/response-page', calls[0].options.pathname);
        assertEqual('default.html', calls[0].options.baseTemplateId);
        assertEqual('client-partial', calls[0].options.partial);
        assertEqual(true, calls[0].options.skipBaseRender);
        assertEqual(request.url, calls[0].options.url);
        assertEqual(response.props, calls[0].options.props);
        assertEqual('<main>Account</main>', response.body);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
    });

    it('does not place rendering controls in template props', async () => {
        const { calls, context } = makeSubject();
        const response = new ServerResponse();
        response.updateProps({ page: { title: 'Account' } });
        response.setRenderingOptions({ pathname: '/account' });

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual('/account', calls[0].options.pathname);
        assertEqual(undefined, response.props.pathname);
        assertEqual('Account', response.props.page.title);
    });

    it('preserves an explicit hypertext content type', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(
            context,
            makeRequest(),
            response,
            { responseOptions: { contentType: 'application/xml' } },
        );

        assertEqual('application/xml; charset=utf-8', response.headers.get('content-type'));
    });

    it('serializes a page-context result without passing response options to the service', async () => {
        const { calls, context } = makeSubject();
        context.getService = () => ({
            async renderPage(_context, options) {
                calls.push({ options });
                return { type: 'page-context', pageContext: { pathname: '/' } };
            },
        });
        const response = new ServerResponse();

        await respondWithHyperviewPage(
            context,
            makeRequest(),
            response,
            { responseOptions: { contentType: 'text/html' } },
        );

        assertEqual('/', JSON.parse(response.body).pathname);
        assertEqual(undefined, calls[0].options.responseOptions);
    });
});
