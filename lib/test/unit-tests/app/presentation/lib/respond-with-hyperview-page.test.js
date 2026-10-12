import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import respondWithHyperviewPage from '../../../../../src/app/presentation/lib/respond-with-hyperview-page.js';
import ServerResponse from '../../../../../src/kixx/http-router/server-response.js';
import { sha256Hex } from '../../../../../src/kixx/utils/crypto.js';


const PUBLIC_OPTIONS = { responseOptions: { cacheControl: 'public, no-cache' } };


function makeRequest(headers, href, method) {
    return {
        method: method ?? 'GET',
        headers: new Headers(headers),
        url: new URL(href ?? 'https://www.example.com/'),
    };
}

async function getBodyEtag() {
    return `"${ await sha256Hex('<main>Account</main>') }"`;
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

    it('varies every response on the render mode request headers', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual('kixx-partial, kixx-boosted', response.headers.get('vary'));
    });

    it('adds no cache policy or validator without responseOptions.cacheControl', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('sets the configured cache policy and a body-hash ETag', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual('public, no-cache', response.headers.get('cache-control'));
        assertEqual(await getBodyEtag(), response.headers.get('etag'));
        assertEqual('<main>Account</main>', response.body);
    });

    it('responds 304 without a body when If-None-Match matches, including a weakened ETag', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        const request = makeRequest({ 'if-none-match': `W/${ await getBodyEtag() }` });

        await respondWithHyperviewPage(context, request, response, PUBLIC_OPTIONS);

        assertEqual(304, response.status);
        assertEqual(null, response.body);
        assertEqual(null, response.headers.get('content-type'));
        assertEqual(null, response.headers.get('content-length'));
        assertEqual(await getBodyEtag(), response.headers.get('etag'));
        assertEqual('public, no-cache', response.headers.get('cache-control'));
        assertEqual('kixx-partial, kixx-boosted', response.headers.get('vary'));
    });

    it('responds 200 when If-None-Match does not match', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest({ 'if-none-match': '"stale"' }), response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual('<main>Account</main>', response.body);
    });

    it('does not apply the cache policy to an error status', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        response.status = 422;

        await respondWithHyperviewPage(context, makeRequest({ 'if-none-match': await getBodyEtag() }), response, PUBLIC_OPTIONS);

        assertEqual(422, response.status);
        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('does not apply the cache policy to a POST', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        const request = makeRequest({ 'if-none-match': await getBodyEtag() }, null, 'POST');

        await respondWithHyperviewPage(context, request, response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('does not pass cacheControl to the render service', async () => {
        const { calls, context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response, PUBLIC_OPTIONS);

        assertEqual(undefined, calls[0].options.responseOptions);
        assertEqual(undefined, calls[0].options.cacheControl);
    });
});
